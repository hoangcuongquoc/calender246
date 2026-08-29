// Theo dõi TIẾN ĐỘ THẬT của các lệnh gọi API lúc vừa mở app (sự kiện, lời mời, lịch được
// chia sẻ, nhóm, cài đặt). LoadingScreenComponent dùng progress() để vẽ thanh chạy đúng %
// đã tải xong — không phải thanh chạy giả (trước đây là animation trượt cố định).
//
// Mỗi service tải dữ liệu lúc khởi động gọi markDone(task) đúng lúc nó xong (thành công
// HAY lỗi đều tính, vì mục đích là biết "đã thử xong", không phải "đã thành công").

import { Injectable, computed, signal } from '@angular/core';

export type StartupTask = 'events' | 'invitations' | 'sharedCalendars' | 'groups' | 'settings';

const ALL_TASKS: StartupTask[] = ['events', 'invitations', 'sharedCalendars', 'groups', 'settings'];

@Injectable({ providedIn: 'root' })
export class AppStartupService {
  private readonly doneTasks = signal<Set<StartupTask>>(new Set());

  markDone(task: StartupTask): void {
    if (this.doneTasks().has(task)) return; // idempotent: reload() gọi lại nhiều lần sau này không ảnh hưởng
    this.doneTasks.update((s) => new Set(s).add(task));
  }

  /** 0..1 — dùng để đặt width của thanh tiến trình. */
  readonly progress = computed(() => this.doneTasks().size / ALL_TASKS.length);

  /** true khi TẤT CẢ các lệnh tải lúc khởi động đã xong ít nhất 1 lần. */
  readonly isReady = computed(() => this.doneTasks().size >= ALL_TASKS.length);
}
