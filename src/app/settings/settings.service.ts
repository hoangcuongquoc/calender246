// SettingsService (frontend): nguồn sự thật của Settings ở client.
//
// - settings(): signal chứa UserSettings hiện tại (mặc định trước khi tải xong).
// - load(): GET /api/settings, áp dụng theme + default view.
// - update(patch): cập nhật LẠC QUAN (đổi UI ngay) rồi PATCH; lỗi -> khôi phục.
//
// Áp dụng realtime: theme (qua ThemeService) và default view (qua CalendarStateService).
// Cung cấp helper formatTime/formatDate/weekStartsOn cho các view lịch dùng (Lát sau).

import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { ThemeService } from '../theme.service';
import { CalendarStateService } from '../calendar/calendar-state.service';
import { DEFAULT_SETTINGS, UserSettings } from './settings.types';
import { AppStartupService } from '../shared/app-startup.service';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly theme = inject(ThemeService);
  private readonly calendar = inject(CalendarStateService);
  private readonly startup = inject(AppStartupService);

  readonly settings = signal<UserSettings>(DEFAULT_SETTINGS);
  readonly loaded = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  private defaultViewApplied = false;

  constructor() {
    // Đồng bộ cờ "hiện task đã hoàn thành" xuống CalendarState mỗi khi settings đổi
    // (load / cập nhật lạc quan / khôi phục khi lỗi đều được phủ).
    effect(() => {
      this.calendar.showCompletedTasks.set(this.settings().show_completed_tasks);
    });
  }

  /** Helper phái sinh cho component khác đọc nhanh. */
  readonly weekStartsOn = computed(() => this.settings().start_of_week);
  readonly is24h = computed(() => this.settings().time_format === '24h');

  private get baseUrl() {
    return `${environment.apiUrl}/settings`;
  }

  /** Tải settings từ server. Gọi khi user đăng nhập. */
  async load(): Promise<void> {
    try {
      const data = await firstValueFrom(
        this.http.get<UserSettings>(this.baseUrl),
      );
      this.settings.set({ ...DEFAULT_SETTINGS, ...data });
      this.loaded.set(true);
      this.applyTheme();
      this.applyDefaultViewOnce();
      this.startup.markDone('settings');
    } catch {
      // Chưa đăng nhập / server chưa chạy: giữ mặc định, không chặn app.
      this.loaded.set(false);
      this.startup.markDone('settings');
    }
  }

  /** Đặt lại về mặc định khi đăng xuất. */
  reset(): void {
    this.settings.set(DEFAULT_SETTINGS);
    this.loaded.set(false);
    this.defaultViewApplied = false;
  }

  /**
   * Cập nhật 1 phần settings. Đổi UI ngay (optimistic), gọi PATCH, lỗi -> khôi phục.
   * Nested (email_preferences/ai_settings) được merge nông ở client cho khớp server.
   */
  async update(patch: Partial<UserSettings>): Promise<boolean> {
    const previous = this.settings();
    const merged: UserSettings = {
      ...previous,
      ...patch,
      email_preferences: {
        ...previous.email_preferences,
        ...(patch.email_preferences ?? {}),
      },
      ai_settings: { ...previous.ai_settings, ...(patch.ai_settings ?? {}) },
    };
    this.settings.set(merged);
    this.applyTheme();
    this.saving.set(true);
    this.error.set(null);

    try {
      const saved = await firstValueFrom(
        this.http.patch<UserSettings>(this.baseUrl, patch),
      );
      this.settings.set({ ...DEFAULT_SETTINGS, ...saved });
      this.applyTheme();
      return true;
    } catch (e: any) {
      this.settings.set(previous); // khôi phục
      this.applyTheme();
      this.error.set(e?.error?.message ?? 'Lưu cài đặt thất bại.');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  private applyTheme(): void {
    this.theme.setMode(this.settings().theme);
  }

  private applyDefaultViewOnce(): void {
    if (this.defaultViewApplied) return;
    this.defaultViewApplied = true;
    this.calendar.setViewMode(this.settings().default_calendar_view);
  }

  // ------- Helper định dạng ngày/giờ theo settings (dùng cho các view lịch) -------

  formatTime(d: Date): string {
    const s = this.settings();
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: s.time_format === '12h',
      timeZone: s.timezone,
    }).format(d);
  }

  formatDate(d: Date): string {
    const s = this.settings();
    const parts = new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: s.timezone,
    }).formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value ?? '';
    const m = parts.find((p) => p.type === 'month')?.value ?? '';
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    switch (s.date_format) {
      case 'MM/DD/YYYY':
        return `${m}/${day}/${y}`;
      case 'YYYY-MM-DD':
        return `${y}-${m}-${day}`;
      default:
        return `${day}/${m}/${y}`;
    }
  }
}
