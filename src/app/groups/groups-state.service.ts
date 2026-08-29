// GroupsStateService — Bộ nhớ tạm cho tính năng nhóm.
// Giữ danh sách nhóm và các sự kiện nhóm để hiển thị lên lịch; xử lý tạo/tham gia/mời/xóa nhóm.

import { Injectable, computed, inject, signal } from '@angular/core';
import { CalendarEvent } from '../calendar/calendar.types';
import { GroupsApiService } from './groups-api.service';
import { GoogleMeetService } from './google-meet.service';
import { GroupRealtimeService, GroupEventMessage } from './realtime.service';
import { Group, PendingGroupInvite } from './groups.types';
import { AppStartupService } from '../shared/app-startup.service';

@Injectable({ providedIn: 'root' })
export class GroupsStateService {
  private readonly api = inject(GroupsApiService);
  private readonly meet = inject(GoogleMeetService);
  private readonly realtime = inject(GroupRealtimeService);
  private readonly startup = inject(AppStartupService);

  readonly groups = signal<Group[]>([]);
  readonly error = signal<string | null>(null);
  /** Thông báo ngắn khi lịch nhóm vừa thay đổi (tự ẩn) */
  readonly flash = signal<string | null>(null);

  /** Lời mời nhóm đang chờ mình đồng ý (hiện nút Đồng ý/Từ chối ở sidebar). */
  readonly pendingInvites = signal<PendingGroupInvite[]>([]);

  /** Nhóm nào đang được "hiện" trên lịch (mặc định: hiện tất cả) */
  readonly visibleGroupIds = signal<Set<string>>(new Set());
  /** Nhóm nào đang mở panel chi tiết */
  readonly panelGroupId = signal<string | null>(null);
  readonly panelGroup = signal<Group | null>(null);
  /** Tab muốn mở sẵn khi bật panel ('events' | 'chat') */
  readonly panelInitialTab = signal<'events' | 'chat'>('events');
  /** Tăng mỗi lần mở panel — để panel áp dụng lại tab mong muốn kể cả khi mở lại cùng nhóm */
  readonly panelOpenSeq = signal(0);

  /** Sự kiện theo nhóm: groupId -> danh sách CalendarEvent */
  private readonly groupEvents = signal<Record<string, CalendarEvent[]>>({});

  private started = false;

  /** Số người đang online trong 1 nhóm (từ presence realtime) */
  onlineCount(groupId: string): number {
    return this.realtime.presence()[groupId]?.length ?? 0;
  }

  /** Danh sách email đang online trong 1 nhóm */
  onlineEmails(groupId: string): string[] {
    return this.realtime.presence()[groupId] ?? [];
  }

  /**
   * Sự kiện của các nhóm ĐANG HIỆN — calendar-page gộp cái này vào lịch.
   * Không còn ép màu theo nhóm nữa: mỗi sự kiện giữ đúng màu do người tạo chọn.
   */
  readonly visibleGroupEvents = computed<CalendarEvent[]>(() => {
    const vis = this.visibleGroupIds();
    const map = this.groupEvents();
    const out: CalendarEvent[] = [];
    for (const id of Object.keys(map)) {
      if (!vis.has(id)) continue;
      for (const e of map[id]) out.push({ ...e, groupId: id });
    }
    return out;
  });

  constructor() {
    // Nghe realtime: mọi thay đổi sự kiện nhóm -> cập nhật ngay không cần reload
    this.realtime.groupEvents$.subscribe((msg) => this.applyRealtime(msg));
    // Nghe realtime: danh sách/thành viên nhóm vừa đổi (tạo/tham gia/mời/xóa/giải tán,
    // kể cả do tab khác hoặc người khác thao tác) -> tự tải lại danh sách, không cần F5.
    this.realtime.groupsChanged$.subscribe(() => this.loadGroups());
  }

  /** Gọi 1 lần khi mở trang lịch: đồng bộ lời mời, tải nhóm, vào phòng realtime. */
  start(): void {
    if (this.started) return;
    this.started = true;
    // Kết nối socket ngay cả khi chưa thuộc nhóm nào, để nhận 'groups:changed' từ lần mời đầu tiên.
    this.realtime.connect();
    this.api.syncInvites().subscribe({ next: () => this.loadGroups(), error: () => this.loadGroups() });
  }

  /** Tải danh sách lời mời nhóm đang chờ mình đồng ý. */
  loadPendingInvites(): void {
    this.api.listPendingInvites().subscribe({
      next: (list) => this.pendingInvites.set(list),
      error: () => this.pendingInvites.set([]),
    });
  }

  /** Đồng ý 1 lời mời -> vào nhóm, tải lại danh sách. */
  acceptInvite(groupId: string): void {
    this.pendingInvites.update((l) => l.filter((i) => i.group_id !== groupId)); // ẩn ngay
    this.api.acceptInvite(groupId).subscribe({
      next: () => this.loadGroups(),
      error: () => this.loadPendingInvites(),
    });
  }

  /** Từ chối 1 lời mời (chủ nhóm vẫn thấy "đã từ chối"). */
  declineInvite(groupId: string): void {
    this.pendingInvites.update((l) => l.filter((i) => i.group_id !== groupId)); // ẩn ngay
    this.api.declineInvite(groupId).subscribe({
      next: () => {},
      error: () => this.loadPendingInvites(),
    });
  }

  /**
   * Tải lại danh sách nhóm — gọi lúc mở trang VÀ mỗi khi nhận 'groups:changed' (realtime).
   * Giữ nguyên trạng thái hiện/ẩn của các nhóm ĐÃ biết (không reset toggle của user mỗi lần
   * có người khác thao tác); nhóm MỚI xuất hiện mặc định hiện. Chỉ join/tải sự kiện cho nhóm
   * thật sự mới, và rời phòng của nhóm không còn thuộc về nữa (bị xóa/giải tán/bị kick).
   */
  loadGroups(): void {
    this.api.list().subscribe({
      next: (groups) => {
        const prevIds = new Set(this.groups().map((g) => g.id));
        const nextIds = new Set(groups.map((g) => g.id));
        this.groups.set(groups);
        this.loadPendingInvites(); // lời mời chờ đổi khi có mời/đồng ý/từ chối

        this.visibleGroupIds.update((prevVisible) => {
          const next = new Set<string>();
          for (const id of nextIds) {
            if (prevIds.has(id)) {
              if (prevVisible.has(id)) next.add(id);
            } else {
              next.add(id); // nhóm mới -> mặc định hiện
            }
          }
          return next;
        });

        this.groupEvents.update((m) => {
          const next: Record<string, CalendarEvent[]> = {};
          for (const id of nextIds) if (m[id]) next[id] = m[id];
          return next;
        });

        for (const g of groups) {
          if (prevIds.has(g.id)) continue;
          this.realtime.joinGroup(g.id);
          this.loadGroupEvents(g.id);
        }
        for (const id of prevIds) {
          if (!nextIds.has(id)) this.realtime.leaveGroup(id);
        }
        this.startup.markDone('groups');
      },
      error: () => {
        this.error.set('Không tải được danh sách nhóm.');
        this.startup.markDone('groups');
      },
    });
  }

  loadGroupEvents(groupId: string): void {
    this.api.listEvents(groupId).subscribe({
      next: (events) => this.groupEvents.update((m) => ({ ...m, [groupId]: events })),
      error: () => {},
    });
  }

  // ---------- Hiện/ẩn nhóm trên lịch ----------
  isVisible(groupId: string): boolean {
    return this.visibleGroupIds().has(groupId);
  }

  toggleVisible(groupId: string): void {
    this.visibleGroupIds.update((s) => {
      const next = new Set(s);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
  }

  // ---------- Panel chi tiết ----------
  openPanel(groupId: string, tab: 'events' | 'chat' = 'events'): void {
    this.panelInitialTab.set(tab);
    this.panelOpenSeq.update((n) => n + 1);
    this.panelGroupId.set(groupId);
    this.panelGroup.set(this.groups().find((g) => g.id === groupId) ?? null);
    this.api.get(groupId).subscribe({
      next: (g) => this.panelGroup.set(g),
      error: () => {},
    });
  }

  closePanel(): void {
    this.panelGroupId.set(null);
    this.panelGroup.set(null);
  }

  // ---------- Nhóm ----------
  createGroup(name: string): void {
    this.api.create(name).subscribe({
      next: (g) => {
        this.groups.update((list) => [...list, g]);
        this.visibleGroupIds.update((s) => new Set(s).add(g.id));
        this.realtime.joinGroup(g.id);
        this.loadGroupEvents(g.id);
        this.openPanel(g.id);
      },
      error: () => this.error.set('Tạo nhóm thất bại.'),
    });
  }

  joinByCode(code: string): void {
    this.api.join(code).subscribe({
      next: (g) => {
        this.groups.update((list) => (list.some((x) => x.id === g.id) ? list : [...list, g]));
        this.visibleGroupIds.update((s) => new Set(s).add(g.id));
        this.realtime.joinGroup(g.id);
        this.loadGroupEvents(g.id);
        this.flash.set(`Đã tham gia nhóm "${g.name}".`);
        this.autoClearFlash();
      },
      error: () => this.error.set('Mã nhóm không đúng hoặc đã xảy ra lỗi.'),
    });
  }

  invite(groupId: string, email: string): void {
    this.api.invite(groupId, email).subscribe({
      next: () => {
        this.openPanel(groupId); // tải lại danh sách thành viên (hiện người vừa mời với nhãn "đã mời")
        this.flash.set(`Đã mời ${email}. Người này sẽ vào nhóm khi đăng nhập bằng email đó.`);
        this.autoClearFlash();
      },
      // Hiện lỗi THẬT từ máy chủ để dễ chẩn đoán (vd 403 nếu không phải chủ nhóm, email sai...).
      error: (e) => this.error.set('Mời thất bại: ' + (e?.error?.message || e?.message || 'lỗi không rõ')),
    });
  }

  removeMember(groupId: string, email: string): void {
    this.api.removeMember(groupId, email).subscribe({
      next: () => this.openPanel(groupId),
      error: () => this.error.set('Xóa thành viên thất bại (chỉ chủ nhóm mới được xóa).'),
    });
  }

  deleteGroup(groupId: string): void {
    this.api.remove(groupId).subscribe({
      next: () => {
        this.groups.update((list) => list.filter((g) => g.id !== groupId));
        this.groupEvents.update((m) => {
          const next = { ...m };
          delete next[groupId];
          return next;
        });
        this.realtime.leaveGroup(groupId);
        this.closePanel();
      },
      error: () => this.error.set('Giải tán nhóm thất bại (chỉ chủ nhóm mới được).'),
    });
  }

  // ---------- Sự kiện nhóm ----------
  createGroupEvent(groupId: string, draft: Omit<CalendarEvent, 'id'>): void {
    this.api.createEvent(groupId, draft).subscribe({
      next: ({ event }) => this.upsertEvent(groupId, event),
      error: () => this.error.set('Tạo sự kiện nhóm thất bại.'),
    });
  }

  updateGroupEvent(groupId: string, eventId: string, draft: Omit<CalendarEvent, 'id'>): void {
    this.api.updateEvent(groupId, eventId, draft).subscribe({
      next: ({ event }) => this.upsertEvent(groupId, event),
      error: () => this.error.set('Cập nhật sự kiện nhóm thất bại.'),
    });
  }

  /** Kéo co giãn 1 sự kiện nhóm -> lưu giờ mới (optimistic) */
  updateGroupEventTimes(event: CalendarEvent): void {
    const groupId = event.groupId;
    if (!groupId) return;
    this.upsertEvent(groupId, event); // cập nhật ngay trên UI
    const { id, ...rest } = event;
    this.api.updateEvent(groupId, id, rest).subscribe({
      next: ({ event: saved }) => this.upsertEvent(groupId, saved),
      error: () => {
        this.error.set('Lưu sự kiện nhóm thất bại.');
        this.loadGroupEvents(groupId);
      },
    });
  }

  deleteGroupEvent(groupId: string, eventId: string): void {
    this.api.deleteEvent(groupId, eventId).subscribe({
      next: () => this.removeEvent(groupId, eventId),
      error: () => this.error.set('Xóa sự kiện nhóm thất bại.'),
    });
  }

  /** Các sự kiện đang trong lúc tạo Meet — để khoá nút, tránh bấm 2 lần tạo 2 phòng. */
  private readonly meetBusyIds = signal<Set<string>>(new Set());

  /** Sự kiện này có đang tạo Meet không (panel dùng để disable nút). */
  isMeetBusy(eventId: string): boolean {
    return this.meetBusyIds().has(eventId);
  }

  private setMeetBusy(eventId: string, busy: boolean): void {
    this.meetBusyIds.update((s) => {
      const next = new Set(s);
      if (busy) next.add(eventId);
      else next.delete(eventId);
      return next;
    });
  }

  /**
   * Tạo phòng Google Meet cho 1 sự kiện nhóm rồi lưu link (mọi thành viên thấy nút "Tham gia Meet").
   *
   * Mỗi sự kiện chỉ giữ ĐÚNG 1 phòng Meet: nếu đã có link thì dùng lại, không gọi Google
   * tạo phòng mới (trước đây bấm lại là sinh thêm phòng thừa, bỏ không). Đồng thời khoá nút
   * trong lúc đang tạo để bấm nhanh 2 lần không tạo ra 2 phòng.
   */
  async createMeetForEvent(groupId: string, eventId: string): Promise<void> {
    this.error.set(null);
    if (this.isMeetBusy(eventId)) return;

    // Đã có sẵn link -> giữ nguyên, khỏi tạo mới.
    const existing = this.eventsOf(groupId).find((e) => e.id === eventId);
    if (existing?.meetLink) {
      this.flash.set('Sự kiện này đã có phòng Meet rồi.');
      this.autoClearFlash();
      return;
    }

    this.setMeetBusy(eventId, true);
    try {
      const link = await this.meet.createSpace(); // gọi Google Meet API (cần quyền + token Google)
      this.api.setMeetLink(groupId, eventId, link).subscribe({
        next: (saved) => {
          this.upsertEvent(groupId, saved);
          this.flash.set('Đã tạo Google Meet cho sự kiện.');
          this.autoClearFlash();
          this.setMeetBusy(eventId, false);
        },
        error: () => {
          this.error.set('Lưu link Meet thất bại.');
          this.setMeetBusy(eventId, false);
        },
      });
    } catch (e: any) {
      this.setMeetBusy(eventId, false);
      // Chưa cấp quyền Meet -> chuyển sang Google xin quyền, xong quay lại bấm "Tạo Meet" lần nữa.
      if (e?.code === 'NEED_CONSENT') {
        await this.meet.requestAccess();
        return;
      }
      this.error.set(e?.message || 'Tạo Google Meet thất bại.');
    }
  }

  /** Gỡ link Google Meet khỏi 1 sự kiện nhóm (cả nhóm cập nhật real-time). */
  removeMeetForEvent(groupId: string, eventId: string): void {
    this.error.set(null);
    this.api.removeMeetLink(groupId, eventId).subscribe({
      next: (saved) => this.upsertEvent(groupId, saved),
      error: () => this.error.set('Gỡ link Meet thất bại.'),
    });
  }

  /** Danh sách sự kiện của 1 nhóm (dùng trong panel) */
  eventsOf(groupId: string): CalendarEvent[] {
    return this.groupEvents()[groupId] ?? [];
  }

  // ---------- Nội bộ ----------
  private applyRealtime(msg: GroupEventMessage): void {
    if (msg.type === 'deleted' && msg.eventId) {
      this.removeEvent(msg.groupId, msg.eventId);
    } else if (msg.event) {
      this.upsertEvent(msg.groupId, msg.event);
    }
    this.flash.set('Lịch nhóm vừa được cập nhật.');
    this.autoClearFlash();
  }

  private upsertEvent(groupId: string, event: CalendarEvent): void {
    this.groupEvents.update((m) => {
      const list = m[groupId] ?? [];
      const exists = list.some((e) => e.id === event.id);
      const next = exists ? list.map((e) => (e.id === event.id ? event : e)) : [...list, event];
      return { ...m, [groupId]: next };
    });
  }

  private removeEvent(groupId: string, eventId: string): void {
    this.groupEvents.update((m) => ({ ...m, [groupId]: (m[groupId] ?? []).filter((e) => e.id !== eventId) }));
  }

  private flashTimer?: ReturnType<typeof setTimeout>;
  private autoClearFlash(): void {
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flash.set(null), 4000);
  }
}
