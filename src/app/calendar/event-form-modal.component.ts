// Modal tạo mới / chỉnh sửa sự kiện — khớp bố cục 3 tab trong hình 4-6 người dùng gửi:
// "Sự kiện" | "Việc cần làm" | "Lên lịch hẹn".
//
// Cảnh báo trùng lịch: mỗi khi start/end thay đổi ở tab "Sự kiện", tính lại `conflicts`
// dựa trên CalendarStateService.findConflicts(). Đây là cảnh báo MỀM (không chặn lưu),
// đúng hành vi Google Calendar thật.
//
// GIAI ĐOẠN 2: nút "Lưu" sẽ gọi HTTP POST/PATCH tới NestJS thay vì state.saveEvent() cục bộ;
// việc thêm khách theo email sẽ tạo record thật trong bảng event_attendees và trigger
// gửi email mời (xem README-tich-hop-calendar.md).

import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CalendarEvent, EventKind, Guest } from './calendar.types';
import { CalendarStateService } from './calendar-state.service';
import { isSameDay } from './date-utils';
import { IconComponent } from '../shared/icon.component';
import { TimePickerComponent } from '../shared/time-picker.component';
import { DateTimePickerComponent } from '../shared/datetime-picker.component';
import { SelectComponent, SelectOption } from '../shared/select.component';
import { TranslateService } from '../i18n/translate.service';
import { SettingsService } from '../settings/settings.service';
import { AttachmentsApiService, MAX_ATTACHMENT_BYTES } from './attachments-api.service';
import { RecurrenceOptions } from './events-api.service';
import { SupabaseService } from '../auth/supabase.service';
import { BookingApiService, BookingPage } from '../booking/booking-api.service';
import { descriptionToHtml } from '../shared/html-text';

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toTimeInputValue(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

// ----- Nhắc lịch linh hoạt: đổi qua lại giữa PHÚT (lưu ở DB) và số + đơn vị (hiển thị) -----
type ReminderUnit = 'minute' | 'hour' | 'day' | 'week';
const UNIT_MIN: Record<ReminderUnit, number> = { minute: 1, hour: 60, day: 1440, week: 10080 };
interface ReminderItem {
  value: number;
  unit: ReminderUnit;
}
/** Đổi tổng số PHÚT -> {số, đơn vị} lớn nhất chia hết (vd 120 -> 2 tiếng, 90 -> 90 phút). */
function minutesToItem(min: number): ReminderItem {
  const m = Math.max(0, Math.round(min));
  if (m > 0 && m % UNIT_MIN.week === 0) return { value: m / UNIT_MIN.week, unit: 'week' };
  if (m > 0 && m % UNIT_MIN.day === 0) return { value: m / UNIT_MIN.day, unit: 'day' };
  if (m > 0 && m % UNIT_MIN.hour === 0) return { value: m / UNIT_MIN.hour, unit: 'hour' };
  return { value: m, unit: 'minute' };
}

// ----- Lặp lại: khóa preset trong dropdown (nhãn tính động theo ngày bắt đầu) -----
type RecurKey = 'none' | 'daily' | 'weekly' | 'monthlyNth' | 'monthlyLast' | 'yearly' | 'weekdays' | 'custom';
type CustomFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

@Component({
  selector: 'app-event-form-modal',
  standalone: true,
  imports: [FormsModule, IconComponent, TimePickerComponent, DateTimePickerComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-backdrop-in fixed inset-0 z-40 flex items-start justify-center bg-black/40 px-4 pt-10 sm:pt-20" (click)="close()">
      <div class="modal-card-in flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden !rounded-[var(--radius-lg)] bg-white p-4 !shadow-[var(--shadow-lg)] sm:p-6" (click)="$event.stopPropagation()">
        <div class="mb-4 flex items-start justify-between gap-4">
          <input
            type="text"
            [(ngModel)]="title"
            (keydown.enter)="onEnterSave()"
            maxlength="200"
            [placeholder]="tr.t('form.addTitle')"
            class="min-w-0 flex-1 border-b border-gray-300 pb-1.5 text-xl font-medium outline-none focus:border-blue-600"
          />
          <button type="button" (click)="close()" class="btn-icon shrink-0" [attr.aria-label]="tr.t('common.close')"><app-icon name="x" class="h-4 w-4" /></button>
        </div>

        <!-- Tabs: Sự kiện / Việc cần làm / Lên lịch hẹn -->
        <div class="mb-4 flex gap-1 rounded-md bg-gray-100 p-1 dark:bg-gray-800/60">
          @for (t of tabs; track t.key) {
            <button
              type="button"
              (click)="tab.set(t.key)"
              class="flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors"
              [class.bg-white]="tab() === t.key"
              [class.shadow-sm]="tab() === t.key"
              [class.text-blue-700]="tab() === t.key"
              [class.text-gray-600]="tab() !== t.key"
            >
              {{ tr.t('kind.' + t.key) }}
            </button>
          }
        </div>

        <!-- Vùng nội dung CUỘN được (tiêu đề + tabs + nút Lưu/Huỷ vẫn cố định) -->
        <!-- pt-1: chừa chỗ cho viền sáng (focus ring, tràn ~3px quanh field) của hàng đầu
             tiên — không có đệm này thì khung cuộn cắt mất phần viền phía trên khi field đó
             được focus (viền/box-shadow không "tràn ra ngoài" vùng cuộn được, luôn bị kẹp lại). -->
        <div class="-mx-4 flex-1 overflow-y-auto px-4 pt-1 sm:-mx-6 sm:px-6">

        <!-- Tab: Sự kiện -->
        @if (tab() === 'event') {
          <div class="space-y-4">
            <div class="space-y-2 text-sm">
              <!-- Bắt đầu -->
              <div class="flex flex-wrap items-center gap-2">
                <span class="w-5 text-center">🕐</span>
                <span class="w-16 shrink-0 font-medium text-gray-600">{{ tr.t('form.start') }}</span>
                <input type="date" [(ngModel)]="startDate" class="field disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400" [disabled]="!canEditTime()" />
                <app-time-picker [(ngModel)]="startTime" [disabled]="isAllDay() || !canEditTime()" />
              </div>
              <!-- Kết thúc — sự kiện có giờ cụ thể: NGÀY khóa theo ngày bắt đầu (gói gọn trong 1
                   ngày). Sự kiện "Cả ngày": cho chọn ngày kết thúc riêng để trải nhiều ngày. -->
              <div class="flex flex-wrap items-center gap-2">
                <span class="w-5 text-center"></span>
                <span class="w-16 shrink-0 font-medium text-gray-600">{{ tr.t('form.end') }}</span>
                @if (isAllDay()) {
                  <input type="date" [(ngModel)]="endDate" [min]="startDate()" [disabled]="!canEditTime()" class="field disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400" />
                } @else {
                  <input type="date" [ngModel]="startDate()" [disabled]="true" [title]="tr.t('form.sameDayHint')" class="field disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400" />
                  <app-time-picker [(ngModel)]="endTime" [disabled]="!canEditTime()" />
                }
              </div>
              @if (!isAllDay()) {
                <p class="pl-[5.75rem] text-xs text-gray-400">{{ tr.t('form.sameDayHint') }}</p>
              }
            </div>
            @if (!canEditTime()) {
              <p class="pl-7 text-xs text-gray-500">🔒 Chỉ người tạo sự kiện mới được đổi giờ bắt đầu/kết thúc.</p>
            }
            <label class="flex items-center gap-2 pl-7 text-sm text-gray-600">
              <input type="checkbox" [(ngModel)]="isAllDay" />{{ tr.t('common.allDay') }}
            </label>

            <!-- Lặp lại: hiện khi TẠO MỚI, hoặc khi SỬA 1 sự kiện CHƯA thuộc chuỗi (chọn lặp -> tạo chuỗi). -->
            @if (!editing() || !editingSeries()) {
              <div class="flex flex-wrap items-center gap-2 pl-7 text-sm text-gray-600">
                <span>🔁</span>
                <app-select [options]="recurSelectOptions()" [ngModel]="recurKey()" (ngModelChange)="onRecurChange($event)" class="min-w-[14rem] flex-1" />
              </div>
              @if (recurKey() === 'custom') {
                <p class="pl-7 text-xs text-gray-500">
                  {{ customSummary() }}
                  <button type="button" (click)="openCustomAgain()" class="ml-1 text-blue-600">{{ tr.t('detail.edit') }}</button>
                </p>
              }
            }

            <!-- #24: sửa 1 mắt trong CHUỖI lặp -> chọn phạm vi áp dụng. -->
            @if (editing() && editingSeries()) {
              <div class="rounded-md bg-blue-50 px-3 py-2 pl-7 text-sm">
                <p class="mb-1 flex items-center gap-1 font-medium text-gray-700">🔁 {{ tr.t('form.recurEditScope') }}</p>
                <label class="flex items-center gap-2 text-gray-700">
                  <input type="radio" name="editScope" value="single" [checked]="editScope() === 'single'" (change)="editScope.set('single')" />
                  {{ tr.t('form.recurThisOnly') }}
                </label>
                <label class="flex items-center gap-2 text-gray-700">
                  <input type="radio" name="editScope" value="series" [checked]="editScope() === 'series'" (change)="editScope.set('series')" />
                  {{ tr.t('form.recurAll') }}
                </label>
              </div>
            }

            @if (conflicts().length > 0) {
              <div class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <p class="flex items-center gap-2"><app-icon name="alert" class="h-4 w-4" /> {{ tr.t('form.conflictA') }} {{ conflicts().length }} {{ tr.t('form.conflictB') }}</p>
                <ul class="mt-1 list-disc pl-5">
                  @for (c of conflicts(); track c.id) {
                    <li>{{ c.title || tr.t('common.untitled') }} — {{ formatRange(c) }}</li>
                  }
                </ul>
              </div>
            }

            <div class="flex items-start gap-2 text-sm">
              <span class="w-5 pt-1.5 text-center">👤</span>
              <div class="flex-1">
                <div class="relative">
                  <div class="flex gap-2">
                    <input
                      type="email"
                      [(ngModel)]="guestEmailDraft"
                      (keydown.enter)="addGuest()"
                      maxlength="254"
                      [placeholder]="tr.t('form.addGuest')"
                      class="min-w-0 flex-1 field"
                    />
                    <button type="button" (click)="addGuest()" class="btn btn-secondary !py-1">{{ tr.t('form.add') }}</button>
                  </div>
                  <!-- Gợi ý các email đã từng mời (autocomplete) -->
                  @if (guestSuggestions().length > 0) {
                    <div class="surface-panel popup-in absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden">
                      @for (s of guestSuggestions(); track s) {
                        <button
                          type="button"
                          (click)="pickSuggestion(s)"
                          class="block w-full truncate px-3 py-1.5 text-left hover:bg-gray-50"
                        >
                          {{ s }}
                        </button>
                      }
                    </div>
                  }
                </div>
                @if (guests().length > 0) {
                  <ul class="mt-2 space-y-1">
                    @for (g of guests(); track g.email) {
                      <li class="flex items-center justify-between gap-2 rounded bg-gray-50 px-2 py-1">
                        <span class="min-w-0 flex-1 break-all">{{ g.email }}</span>
                        <app-select
                          [options]="guestRoleOptions()"
                          [ngModel]="g.canEdit ? 'editor' : 'viewer'"
                          (ngModelChange)="setGuestRole(g.email, $event === 'editor')"
                          class="w-24 shrink-0 !text-xs"
                          [title]="tr.t('form.guestRoleHint')"
                        />
                        <button type="button" (click)="removeGuest(g.email)" class="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700" [attr.aria-label]="tr.t('form.removeGuest')"><app-icon name="x" class="h-3.5 w-3.5" /></button>
                      </li>
                    }
                  </ul>
                }
              </div>
            </div>

            <div class="flex items-center gap-2 text-sm">
              <span class="w-5 text-center">📍</span>
              <input type="text" [(ngModel)]="location" (keydown.enter)="onEnterSave()" maxlength="200" [placeholder]="tr.t('form.addLocation')" class="min-w-0 flex-1 field" />
            </div>

            <!-- Mô tả nhận HTML (đậm, gạch đầu dòng, liên kết...). Nút Xem trước vẽ đúng
                 như lúc mở chi tiết sự kiện để người viết biết mình gõ có đúng không. -->
            <div class="flex items-start gap-2 text-sm">
              <app-icon name="notes" class="mt-1 h-4 w-4 text-gray-500" />
              <div class="min-w-0 flex-1">
                @if (descPreview()) {
                  <div class="rich-text max-h-48 min-h-[3rem] overflow-y-auto break-words rounded-md border border-gray-300 bg-gray-50 px-3 py-2" [innerHTML]="descHtml()"></div>
                } @else {
                  <textarea [(ngModel)]="description" rows="3" maxlength="5000" [placeholder]="tr.t('form.addDesc')" class="min-h-[3rem] max-h-48 w-full resize-none overflow-y-auto whitespace-pre-wrap break-words field [field-sizing:content]"></textarea>
                }
                <div class="mt-1 flex items-start justify-between gap-2">
                
                  @if (description()) {
                    <button type="button" (click)="descPreview.set(!descPreview())" class="tap shrink-0 text-xs text-blue-600 hover:underline">
                      {{ descPreview() ? tr.t('form.htmlEdit') : tr.t('form.htmlPreview') }}
                    </button>
                  }
                </div>
              </div>
            </div>

            <!-- Nhắc trước giờ bắt đầu: nhiều mốc (số + đơn vị) + nội dung tùy chỉnh -->
            <div class="space-y-2 text-sm">
              <div class="flex items-center gap-2 text-gray-500">
                <app-icon name="bell" class="h-4 w-4" />
                <span>{{ tr.t('notif.remindersLabel') }}</span>
              </div>
              @for (r of reminders(); track $index) {
                <div class="flex flex-wrap items-center gap-2 pl-6">
                  <div class="field inline-flex items-stretch overflow-hidden !p-0">
                    <button type="button" (click)="stepReminder($index, -1)" [disabled]="r.value <= 0"
                      class="tap flex w-8 items-center justify-center text-lg leading-none text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 dark:hover:bg-white/5"
                      aria-label="Giảm">−</button>
                    <input
                      type="number" min="0" max="200" step="1" inputmode="numeric"
                      [ngModel]="r.value" (ngModelChange)="setReminderValue($index, $event)"
                      class="w-10 border-x border-[var(--surface-line)] bg-transparent py-2 text-center text-sm focus:outline-none dark:border-[#273244]"
                    />
                    <button type="button" (click)="stepReminder($index, 1)" [disabled]="r.value >= 200"
                      class="tap flex w-8 items-center justify-center text-lg leading-none text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 dark:hover:bg-white/5"
                      aria-label="Tăng">+</button>
                  </div>
                  <app-select [options]="unitOptions()" [ngModel]="r.unit" (ngModelChange)="setReminderUnit($index, $event)" class="w-28" />
                  <span class="text-gray-500">{{ tr.t('notif.before') }}</span>
                  <button type="button" (click)="removeReminder($index)" class="tap ml-auto rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600" [attr.aria-label]="tr.t('notif.removeReminder')">
                    <app-icon name="x" class="h-3.5 w-3.5" />
                  </button>
                </div>
              }
              @if (reminders().length === 0) {
                <p class="pl-6 text-xs text-gray-400">{{ tr.t('notif.none') }}</p>
              }
              <button type="button" (click)="addReminder()" class="tap ml-6 rounded border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                + {{ tr.t('notif.addReminder') }}
              </button>
              @if (reminders().length > 0) {
                <input
                  type="text" [(ngModel)]="reminderMessage" (keydown.enter)="onEnterSave()" maxlength="300"
                  [placeholder]="tr.t('notif.messagePlaceholder')"
                  class="ml-6 block w-[calc(100%-1.5rem)] field"
                />
              }
            </div>

            <!-- Đính kèm tài liệu ngay lúc tạo (có thể hẹn giờ mở/đóng) -->
            <div class="space-y-2 text-sm">
              <div class="flex items-center justify-between">
                <span class="flex items-center gap-2 text-gray-500"><app-icon name="notes" class="h-4 w-4" /> {{ tr.t('attach.title') }}</span>
                <label class="tap cursor-pointer rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50">
                  {{ tr.t('attach.add') }}
                  <input type="file" class="hidden" (change)="onStageFile($event)" />
                </label>
              </div>
              <p class="text-[11px] text-gray-500">{{ tr.t('attach.limit') }}</p>
              @if (stageError()) {
                <p class="rounded bg-red-50 px-2 py-1 text-xs text-red-600">{{ stageError() }}</p>
              }
              <!-- Xếp DỌC thay vì grid-cols-2: 2 cột quá chật để vừa ô ngày + 2 ô giờ cạnh
                   nhau trong modal, gây chồng/cắt chữ. Xếp dọc cho mỗi mốc đủ bề rộng. -->
              <div class="flex flex-col gap-3 rounded bg-gray-50 p-2 text-xs">
                <label class="flex flex-col gap-1 text-gray-500">{{ tr.t('attach.from') }}
                  <app-datetime-picker [(ngModel)]="stageFrom" />
                </label>
                <label class="flex flex-col gap-1 text-gray-500">{{ tr.t('attach.until') }}
                  <app-datetime-picker [(ngModel)]="stageUntil" />
                </label>
                <p class="text-[11px] text-gray-500">{{ tr.t('attach.scheduleHint') }}</p>
              </div>
              @for (s of stagedFiles(); track $index) {
                <div class="flex items-center gap-2 rounded bg-gray-50 px-2 py-1 text-xs">
                  <span class="min-w-0 flex-1 truncate">📎 {{ s.file.name }}</span>
                  @if (s.from) { <span class="shrink-0 text-amber-600">🔒 {{ s.from }}</span> }
                  <button type="button" (click)="removeStaged($index)" class="tap shrink-0 rounded p-0.5 text-gray-400 hover:text-red-600"><app-icon name="x" class="h-3.5 w-3.5" /></button>
                </div>
              }
            </div>
          </div>
        }

        <!-- Tab: Việc cần làm -->
        @if (tab() === 'task') {
          <div class="space-y-4">
            <div class="flex items-center gap-2 text-sm">
              <app-icon name="target" class="h-4 w-4 text-gray-500" />
              <input type="date" [(ngModel)]="startDate" class="field" />
              <app-time-picker [(ngModel)]="startTime" [disabled]="isAllDay()" />
            </div>

            <!-- Cả ngày (việc cần làm không cần giờ cụ thể) -->
            <label class="flex items-center gap-2 pl-6 text-sm text-gray-600">
              <input type="checkbox" [(ngModel)]="isAllDay" />{{ tr.t('common.allDay') }}
            </label>

            <!-- Lặp lại theo chu kỳ: chỉ cho tạo mới -->
            @if (!editing()) {
              <div class="flex flex-wrap items-center gap-2 pl-6 text-sm text-gray-600">
                <span>🔁</span>
                <select [ngModel]="recurKey()" (ngModelChange)="onRecurChange($event)" class="rounded border border-gray-300 px-2 py-1">
                  @for (o of recurOptions(); track o.key) {
                    <option [value]="o.key">{{ o.label }}</option>
                  }
                </select>
              </div>
              @if (recurKey() === 'custom') {
                <p class="pl-6 text-xs text-gray-500">
                  {{ customSummary() }}
                  <button type="button" (click)="openCustomAgain()" class="ml-1 text-blue-600">{{ tr.t('detail.edit') }}</button>
                </p>
              }
            }

            <!-- Mô tả nhận HTML (đậm, gạch đầu dòng, liên kết...). Nút Xem trước vẽ đúng
                 như lúc mở chi tiết sự kiện để người viết biết mình gõ có đúng không. -->
            <div class="flex items-start gap-2 text-sm">
              <app-icon name="notes" class="mt-1 h-4 w-4 text-gray-500" />
              <div class="min-w-0 flex-1">
                @if (descPreview()) {
                  <div class="rich-text max-h-48 min-h-[3rem] overflow-y-auto break-words rounded-md border border-gray-300 bg-gray-50 px-3 py-2" [innerHTML]="descHtml()"></div>
                } @else {
                  <textarea [(ngModel)]="description" rows="3" maxlength="5000" [placeholder]="tr.t('form.addDesc')" class="min-h-[3rem] max-h-48 w-full resize-none overflow-y-auto whitespace-pre-wrap break-words field [field-sizing:content]"></textarea>
                }
                <div class="mt-1 flex items-start justify-between gap-2">
                  <p class="text-xs text-gray-400">{{ tr.t('form.htmlHint') }}</p>
                  @if (description()) {
                    <button type="button" (click)="descPreview.set(!descPreview())" class="tap shrink-0 text-xs text-blue-600 hover:underline">
                      {{ descPreview() ? tr.t('form.htmlEdit') : tr.t('form.htmlPreview') }}
                    </button>
                  }
                </div>
              </div>
            </div>
          </div>
        }

        <!-- Tab: Lên lịch hẹn — bật/tắt trang đặt lịch công khai + lấy link chia sẻ (ngay tại đây) -->
        @if (tab() === 'appointment') {
          <div class="space-y-3 text-sm">
            <p class="text-gray-600">{{ tr.t('form.apptDesc') }}</p>
            <label class="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
              <span class="font-medium">{{ tr.t('booking.enable') }}</span>
              <input type="checkbox" [checked]="bookingPage()?.enabled" (change)="setBooking({ enabled: !bookingPage()?.enabled })" class="accent-blue-600" />
            </label>
            @if (bookingPage()?.enabled) {
              <div>
                <label class="mb-1 block text-gray-600">{{ tr.t('booking.duration') }}</label>
                <!-- Nhập TỰ DO 5..480 phút; kèm vài mốc nhanh cho tiện -->
                <div class="flex items-center gap-2">
                  <input
                    type="number" min="5" max="480" step="5" inputmode="numeric"
                    [ngModel]="bookingPage()?.duration_minutes"
                    (ngModelChange)="setDuration($event)"
                    class="w-28 field !py-2"
                  />
                  <span class="text-gray-500">{{ tr.t('booking.min') }}</span>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                  @for (m of durationPresets; track m) {
                    <button type="button" (click)="setDuration(m)"
                      class="tap rounded-full border px-3 py-1 text-xs"
                      [class]="bookingPage()?.duration_minutes === m ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'"
                    >{{ m }}{{ tr.t('booking.minShort') }}</button>
                  }
                </div>
              </div>
              <div>
                <label class="mb-1 block text-gray-600">{{ tr.t('booking.link') }}</label>
                <input [value]="bookingLink()" readonly class="mb-2 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600" />
                <div class="flex flex-wrap gap-2">
                  <button type="button" (click)="copyBookingLink()" class="btn btn-secondary">{{ bookingCopied() ? tr.t('booking.copied') : tr.t('booking.copy') }}</button>
                  <a [href]="bookingLink()" target="_blank" class="btn btn-secondary">{{ tr.t('booking.open') }}</a>
                </div>
              </div>
            } @else {
              <p class="text-xs text-gray-400">{{ tr.t('form.apptHint') }}</p>
            }
          </div>
        }

        </div>
        <!-- /Vùng cuộn -->

        @if (formError()) {
          <p class="mt-3 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            <app-icon name="alert" class="h-4 w-4 shrink-0" /> {{ formError() }}
          </p>
        }

        <div class="mt-6 flex justify-end gap-2">
          <button type="button" (click)="close()" class="btn btn-ghost">{{ tr.t('del.cancel') }}</button>
          @if (tab() !== 'appointment') {
            <button
              type="button"
              (click)="save()"
              [disabled]="saving()"
              class="btn btn-primary"
            >{{ saving() ? tr.t('form.saving') : tr.t('form.save') }}</button>
          }
        </div>
      </div>
    </div>

    <!-- Hộp thoại LẶP LẠI TÙY CHỈNH (lớp phủ riêng, nằm trên modal sự kiện) -->
    @if (showCustomRecur()) {
      <div class="modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" (click)="cancelCustom()">
        <div class="modal-card-in w-full max-w-sm !rounded-[var(--radius-lg)] bg-white p-6 !shadow-[var(--shadow-lg)]" (click)="$event.stopPropagation()">
          <h3 class="mb-4 text-lg font-medium text-gray-800">{{ tr.t('recur.title') }}</h3>

          <!-- Lặp lại mỗi N [đơn vị] -->
          <div class="mb-4 flex items-center gap-2 text-sm">
            <span class="text-gray-600">{{ tr.t('recur.every') }}</span>
            <input type="number" min="1" max="999" [ngModel]="customInterval()" (ngModelChange)="customInterval.set(+$event || 1)" class="w-16 field" />
            <app-select [options]="customFreqOptions()" [ngModel]="customFreq()" (ngModelChange)="setCustomFreq($event)" class="w-32" />
          </div>

          <!-- Lặp lại vào các thứ (chỉ khi theo tuần) -->
          @if (customFreq() === 'weekly') {
            <div class="mb-4">
              <p class="mb-2 text-sm text-gray-600">{{ tr.t('recur.on') }}</p>
              <div class="flex flex-wrap gap-1.5">
                @for (i of weekdayIdx; track i) {
                  <button
                    type="button" (click)="toggleCustomWeekday(i)"
                    class="tap h-9 w-9 rounded-full text-xs font-medium"
                    [class.bg-blue-600]="customWeekdays().includes(i)"
                    [class.text-white]="customWeekdays().includes(i)"
                    [class.bg-gray-100]="!customWeekdays().includes(i)"
                    [class.text-gray-700]="!customWeekdays().includes(i)"
                  >{{ tr.t('wd.' + i) }}</button>
                }
              </div>
            </div>
          }

          <!-- Kết thúc -->
          <div class="mb-5">
            <p class="mb-2 text-sm text-gray-600">{{ tr.t('recur.ends') }}</p>
            <label class="mb-1.5 flex items-center gap-2 text-sm">
              <input type="radio" name="recurEnd" [checked]="customEndType() === 'never'" (change)="customEndType.set('never')" />
              {{ tr.t('recur.never') }}
            </label>
            <label class="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
              <input type="radio" name="recurEnd" [checked]="customEndType() === 'until'" (change)="customEndType.set('until')" />
              {{ tr.t('recur.onDate') }}
              <input type="date" [ngModel]="customUntil()" (ngModelChange)="customUntil.set($event)" [disabled]="customEndType() !== 'until'" class="field disabled:bg-gray-100 disabled:text-gray-400" />
            </label>
            <label class="flex flex-wrap items-center gap-2 text-sm">
              <input type="radio" name="recurEnd" [checked]="customEndType() === 'count'" (change)="customEndType.set('count')" />
              {{ tr.t('recur.after') }}
              <input type="number" min="1" max="366" [ngModel]="customCount()" (ngModelChange)="customCount.set(+$event || 1)" [disabled]="customEndType() !== 'count'" class="w-16 field disabled:bg-gray-100 disabled:text-gray-400" />
              {{ tr.t('recur.times') }}
            </label>
          </div>

          <div class="flex justify-end gap-2">
            <button type="button" (click)="cancelCustom()" class="btn btn-ghost">{{ tr.t('del.cancel') }}</button>
            <button type="button" (click)="applyCustom()" class="btn btn-primary">{{ tr.t('recur.done') }}</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class EventFormModalComponent {
  protected readonly state = inject(CalendarStateService);
  protected readonly tr = inject(TranslateService);
  private readonly settings = inject(SettingsService);
  private readonly attachmentsApi = inject(AttachmentsApiService);
  private readonly supabase = inject(SupabaseService);
  private readonly bookingApi = inject(BookingApiService);

  // ----- Lịch hẹn công khai (booking) — cấu hình ngay trong tab "Lên lịch hẹn" -----
  protected readonly bookingPage = signal<BookingPage | null>(null);
  protected readonly bookingCopied = signal(false);
  protected bookingLink(): string {
    const p = this.bookingPage();
    return p ? `${window.location.origin}/book/${p.slug}` : '';
  }
  protected setBooking(patch: Partial<BookingPage>): void {
    const prev = this.bookingPage();
    if (prev) this.bookingPage.set({ ...prev, ...patch });
    this.bookingApi.updateMyPage(patch).subscribe({
      next: (p) => this.bookingPage.set(p),
      error: () => { if (prev) this.bookingPage.set(prev); },
    });
  }
  protected copyBookingLink(): void {
    navigator.clipboard?.writeText(this.bookingLink());
    this.bookingCopied.set(true);
    setTimeout(() => this.bookingCopied.set(false), 1500);
  }
  /** Mốc thời lượng bấm nhanh (vẫn nhập tự do được ở ô số). */
  protected readonly durationPresets = [15, 30, 45, 60, 90, 120];
  /** Đặt thời lượng, chặn trong khoảng hợp lệ 5..480 phút (khớp ràng buộc ở DB). */
  protected setDuration(v: number | string): void {
    const n = Math.min(Math.max(Math.round(Number(v) || 0), 5), 480);
    this.setBooking({ duration_minutes: n });
  }
  /** Tải cấu hình trang đặt lịch (gọi khi mở tab Lịch hẹn lần đầu). */
  private loadBookingOnce(): void {
    if (this.bookingPage()) return;
    this.bookingApi.getMyPage().subscribe({ next: (p) => this.bookingPage.set(p), error: () => {} });
  }

  // ----- Tài liệu đính kèm ngay lúc tạo (xếp hàng, upload sau khi lưu) -----
  protected readonly stagedFiles = signal<{ file: File; from: string; until: string }[]>([]);
  protected readonly stageFrom = signal('');
  protected readonly stageUntil = signal('');
  /** Lỗi khi chọn tệp không hợp lệ (vd quá dung lượng). */
  protected readonly stageError = signal('');
  protected onStageFile(evt: Event): void {
    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    // Chặn file vượt giới hạn ngay tại client.
    if (file.size > MAX_ATTACHMENT_BYTES) {
      this.stageError.set(this.tr.t('attach.tooLarge'));
      input.value = '';
      return;
    }
    this.stageError.set('');
    this.stagedFiles.update((l) => [...l, { file, from: this.stageFrom(), until: this.stageUntil() }]);
    this.stageFrom.set('');
    this.stageUntil.set('');
    input.value = '';
  }
  protected removeStaged(i: number): void {
    this.stagedFiles.update((l) => l.filter((_, idx) => idx !== i));
  }
  /** Upload các file đã xếp hàng vào event vừa tạo. */
  private uploadStaged(eventId: string): void {
    for (const s of this.stagedFiles()) {
      this.attachmentsApi
        .upload(eventId, s.file, {
          availableFrom: s.from ? new Date(s.from).toISOString() : null,
          availableUntil: s.until ? new Date(s.until).toISOString() : null,
        })
        .subscribe({ error: () => {} });
    }
    this.stagedFiles.set([]);
  }

  /**
   * Chỉ NGƯỜI TẠO mới được đổi giờ bắt đầu/kết thúc. Khi tạo mới -> luôn cho phép.
   * Khi sửa -> so email người tạo với email đang đăng nhập (không xác định được thì cho
   * phép, để backend là nơi quyết định cuối cùng).
   */
  canEditTime = computed(() => {
    if (!this.editing()) return true;
    const creator = this.state.editingEvent()?.creatorEmail;
    const me = this.supabase.user()?.email;
    if (!creator || !me) return true;
    return creator.toLowerCase() === me.toLowerCase();
  });

  // ----- Nhắc lịch: danh sách mốc (số + đơn vị) + nội dung tùy chỉnh -----
  readonly reminders = signal<ReminderItem[]>([]);
  readonly reminderMessage = signal('');

  addReminder(): void {
    this.reminders.update((l) => [...l, { value: 10, unit: 'minute' }]);
  }
  removeReminder(i: number): void {
    this.reminders.update((l) => l.filter((_, idx) => idx !== i));
  }
  setReminderValue(i: number, v: number | string): void {
    // Chặn [0, 200] và làm tròn số nguyên (bỏ ký tự lạ / số âm).
    const n = Math.min(Math.max(Math.round(Number(v) || 0), 0), 200);
    this.reminders.update((l) => l.map((r, idx) => (idx === i ? { ...r, value: n } : r)));
  }
  /** Nút −/+ của stepper: tăng/giảm 1 đơn vị, vẫn kẹp trong [0, 200]. */
  stepReminder(i: number, delta: number): void {
    const cur = this.reminders()[i]?.value ?? 0;
    this.setReminderValue(i, cur + delta);
  }
  setReminderUnit(i: number, u: ReminderUnit): void {
    this.reminders.update((l) => l.map((r, idx) => (idx === i ? { ...r, unit: u } : r)));
  }
  /** Đổi danh sách hiển thị -> mảng PHÚT (khử trùng) để gửi backend. */
  private reminderMinutesList(): number[] {
    const set = new Set<number>();
    for (const r of this.reminders()) {
      const v = Math.min(Math.max(Math.round(r.value || 0), 0), 200);
      set.add(v * UNIT_MIN[r.unit]);
    }
    return [...set].sort((a, b) => a - b);
  }

  readonly tabs: { key: EventKind; label: string }[] = [
    { key: 'event', label: 'Sự kiện' },
    { key: 'task', label: 'Việc cần làm' },
    { key: 'appointment', label: 'Lên lịch hẹn' },
  ];

  tab = signal<EventKind>('event');
  title = signal('');
  startDate = signal('');
  startTime = signal('');
  endDate = signal('');
  endTime = signal('');
  /** Thông báo lỗi trong form (vd giờ kết thúc trước giờ bắt đầu, hoặc lưu server thất bại). */
  protected readonly formError = signal('');
  /** true trong lúc chờ server phản hồi — khóa nút Lưu để tránh bấm nhiều lần tạo trùng sự kiện. */
  protected readonly saving = signal(false);
  isAllDay = signal(false);
  location = signal('');
  description = signal('');
  /** true = đang xem thử mô tả dưới dạng HTML thay vì gõ. Đóng modal thì trả về gõ. */
  protected readonly descPreview = signal(false);
  /** Bản xem trước: dựng đúng như lúc mở chi tiết sự kiện. */
  protected readonly descHtml = computed(() => descriptionToHtml(this.description()));
  guests = signal<Guest[]>([]);
  guestEmailDraft = signal('');
  /** Màu sự kiện: không cho chọn nữa, mọi sự kiện mới dùng chung một màu. */
  color = signal('sky');
  /** true khi đang SỬA event có sẵn. */
  editing = signal(false);
  /** #24: true khi event đang sửa THUỘC một chuỗi lặp -> hiện lựa chọn "chỉ mục này / cả chuỗi". */
  editingSeries = signal(false);
  /** #24: phạm vi áp dụng khi sửa 1 mắt trong chuỗi. */
  editScope = signal<'single' | 'series'>('single');

  // ----- Lặp lại (recurrence) -----
  readonly weekdayIdx = [0, 1, 2, 3, 4, 5, 6];
  readonly recurKey = signal<RecurKey>('none');
  private prevRecurKey: RecurKey = 'none';
  // Hộp thoại "Tùy chỉnh…"
  readonly showCustomRecur = signal(false);
  readonly customFreq = signal<CustomFreq>('weekly');
  readonly customInterval = signal(1);
  readonly customWeekdays = signal<number[]>([]);
  readonly customEndType = signal<'never' | 'until' | 'count'>('never');
  readonly customUntil = signal('');
  readonly customCount = signal(13);

  /** Các lựa chọn trong dropdown lặp — nhãn tính theo NGÀY bắt đầu (giống Google). */
  readonly recurOptions = computed<{ key: RecurKey; label: string }[]>(() => {
    const d = this.computedStart();
    const en = this.tr.lang() === 'en';
    const valid = !isNaN(d.getTime());
    const locale = en ? 'en-US' : 'vi-VN';
    const wd = valid ? new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(d) : '';
    const day = valid ? d.getDate() : 1;
    const month = valid ? d.getMonth() + 1 : 1;
    const nth = Math.ceil(day / 7);
    const nthLabel = en ? this.ordinalEn(nth) : `lần ${nth}`;
    return [
      { key: 'none', label: this.tr.t('form.noRepeat') },
      { key: 'daily', label: this.tr.t('form.daily') },
      { key: 'weekly', label: en ? `Weekly on ${wd}` : `Hàng tuần vào ${wd}` },
      { key: 'monthlyNth', label: en ? `Monthly on the ${nthLabel} ${wd}` : `Hàng tháng vào ${wd} ${nthLabel}` },
      { key: 'monthlyLast', label: en ? `Monthly on the last ${wd}` : `Hàng tháng vào ${wd} cuối cùng` },
      { key: 'yearly', label: en ? `Annually on ${month}/${day}` : `Hàng năm vào ngày ${day}/${month}` },
      { key: 'weekdays', label: this.tr.t('form.everyWeekday') },
      { key: 'custom', label: this.tr.t('form.custom') },
    ];
  });
  /** app-select cần shape {value,label} — recurOptions() dùng {key,label} nên map lại. */
  readonly recurSelectOptions = computed<SelectOption[]>(() =>
    this.recurOptions().map((o) => ({ value: o.key, label: o.label })),
  );

  readonly guestRoleOptions = computed<SelectOption[]>(() => [
    { value: 'viewer', label: this.tr.t('share.viewer') },
    { value: 'editor', label: this.tr.t('share.editor') },
  ]);

  readonly unitOptions = computed<SelectOption[]>(() => [
    { value: 'minute', label: this.tr.t('unit.minute') },
    { value: 'hour', label: this.tr.t('unit.hour') },
    { value: 'day', label: this.tr.t('unit.day') },
    { value: 'week', label: this.tr.t('unit.week') },
  ]);

  readonly customFreqOptions = computed<SelectOption[]>(() => [
    { value: 'daily', label: this.tr.t('recur.day') },
    { value: 'weekly', label: this.tr.t('recur.week') },
    { value: 'monthly', label: this.tr.t('recur.month') },
    { value: 'yearly', label: this.tr.t('recur.year') },
  ]);

  /** Tóm tắt ngắn cấu hình "Tùy chỉnh" để hiện dưới dropdown. */
  readonly customSummary = computed<string>(() => {
    const f = this.customFreq();
    const n = Math.max(1, this.customInterval() || 1);
    const unit = this.tr.t(f === 'daily' ? 'unit.day' : f === 'weekly' ? 'unit.week' : f === 'monthly' ? 'recur.month' : 'recur.year');
    let s = `${this.tr.t('recur.every')} ${n} ${unit}`;
    if (f === 'weekly' && this.customWeekdays().length) {
      s += ` (${[...this.customWeekdays()].sort((a, b) => a - b).map((i) => this.tr.t('wd.' + i)).join(', ')})`;
    }
    const et = this.customEndType();
    if (et === 'count') s += ` · ${this.tr.t('recur.after')} ${this.customCount()} ${this.tr.t('recur.times')}`;
    else if (et === 'until' && this.customUntil()) s += ` · ${this.tr.t('recur.onDate')} ${this.customUntil()}`;
    return s;
  });

  private ordinalEn(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  onRecurChange(key: RecurKey): void {
    if (key === 'custom') {
      if (this.recurKey() !== 'custom') this.prevRecurKey = this.recurKey();
      this.initCustom();
      this.recurKey.set('custom');
      this.showCustomRecur.set(true);
    } else {
      this.recurKey.set(key);
    }
  }
  private initCustom(): void {
    const d = this.computedStart();
    const wd = isNaN(d.getTime()) ? 1 : d.getDay();
    this.customFreq.set('weekly');
    this.customInterval.set(1);
    this.customWeekdays.set([wd]);
    this.customEndType.set('never');
    this.customUntil.set('');
    this.customCount.set(13);
  }
  openCustomAgain(): void {
    this.showCustomRecur.set(true);
  }
  setCustomFreq(f: CustomFreq): void {
    this.customFreq.set(f);
    if (f === 'weekly' && this.customWeekdays().length === 0) {
      const d = this.computedStart();
      this.customWeekdays.set([isNaN(d.getTime()) ? 1 : d.getDay()]);
    }
  }
  toggleCustomWeekday(i: number): void {
    this.customWeekdays.update((l) => (l.includes(i) ? l.filter((x) => x !== i) : [...l, i].sort((a, b) => a - b)));
  }
  applyCustom(): void {
    this.showCustomRecur.set(false);
  }
  cancelCustom(): void {
    this.showCustomRecur.set(false);
    this.recurKey.set(this.prevRecurKey);
  }

  /** Dựng tùy chọn lặp gửi backend từ preset / hộp thoại tùy chỉnh; undefined = không lặp. */
  private buildRecurrence(): RecurrenceOptions | undefined {
    const key = this.recurKey();
    if (key === 'none') return undefined;
    const d = this.computedStart();
    const wd = isNaN(d.getTime()) ? 0 : d.getDay();
    switch (key) {
      case 'daily':
        return { freq: 'daily', interval: 1 };
      case 'weekly':
        return { freq: 'weekly', interval: 1, weekdays: [wd] };
      case 'monthlyNth':
        return { freq: 'monthly', interval: 1, monthlyMode: 'nthWeekday' };
      case 'monthlyLast':
        return { freq: 'monthly', interval: 1, monthlyMode: 'lastWeekday' };
      case 'yearly':
        return { freq: 'yearly', interval: 1 };
      case 'weekdays':
        return { freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] };
      case 'custom': {
        const freq = this.customFreq();
        const rec: RecurrenceOptions = { freq, interval: Math.max(1, this.customInterval() || 1) };
        if (freq === 'weekly') rec.weekdays = this.customWeekdays().length ? this.customWeekdays() : [wd];
        if (freq === 'monthly') rec.monthlyMode = 'monthday';
        if (this.customEndType() === 'until' && this.customUntil()) rec.until = new Date(`${this.customUntil()}T23:59`).toISOString();
        if (this.customEndType() === 'count') rec.count = Math.min(Math.max(this.customCount() || 1, 1), 366);
        return rec;
      }
    }
    return undefined;
  }

  private editingId: string | null = null;

  constructor() {
    // Mở tab "Lên lịch hẹn" -> nạp cấu hình trang đặt lịch công khai (booking) 1 lần.
    effect(() => {
      if (this.state.isFormOpen() && this.tab() === 'appointment') this.loadBookingOnce();
    });
    // Mỗi khi modal được mở, nạp lại dữ liệu: nếu đang sửa -> điền dữ liệu event cũ,
    // nếu tạo mới -> điền giờ mặc định (giờ được click trên lưới, +1 tiếng cho giờ kết thúc)
    // CHỈ nạp lại form khi MỞ form hoặc ĐỔI sang sự kiện khác.
    // Trước đây effect này đọc thẳng editingEvent() — vốn phụ thuộc danh sách sự kiện —
    // nên mỗi lần app tải lại dữ liệu (poll 30s / realtime) là form bị RESET ngầm giữa
    // chừng: kiểu lặp về "Không lặp", tiêu đề/giờ vừa nhập cũng mất.
    effect(() => {
      const open = this.state.isFormOpen();
      this.state.editingEventId(); // signal thuần -> chỉ chạy lại khi đổi sự kiện đang sửa
      if (!open) return;
      untracked(() => this.loadFormFromState());
    });
  }

  /** Đổ dữ liệu vào form: đang sửa -> điền sự kiện cũ; tạo mới -> giá trị mặc định. */
  private loadFormFromState(): void {
    {
      const editing = this.state.editingEvent();
      this.editingId = editing?.id ?? null;
      this.editing.set(!!editing);
      this.saving.set(false);
      this.formError.set('');
      this.descPreview.set(false); // mở form lại luôn ở chế độ gõ, không dính xem trước lần trước

      if (editing) {
        this.tab.set(editing.kind);
        this.title.set(editing.title);
        this.startDate.set(toDateInputValue(editing.start));
        this.startTime.set(toTimeInputValue(editing.start));
        this.endDate.set(toDateInputValue(editing.end));
        this.endTime.set(toTimeInputValue(editing.end));
        this.isAllDay.set(editing.isAllDay);
        this.location.set(editing.location ?? '');
        this.description.set(editing.description ?? '');
        this.guests.set(editing.guests);
        this.color.set(editing.color ?? 'sky');
        // Nhắc: ưu tiên mảng mới; sự kiện CŨ chỉ có reminderMinutes -> chuyển thành 1 mốc.
        const mins =
          editing.reminders && editing.reminders.length
            ? editing.reminders
            : editing.reminderMinutes != null
              ? [editing.reminderMinutes]
              : [];
        this.reminders.set(mins.map(minutesToItem));
        this.reminderMessage.set(editing.reminderMessage ?? '');
        // #24: biết event có thuộc chuỗi lặp không -> quyết định hiện dropdown lặp hay lựa chọn phạm vi.
        this.editingSeries.set(!!editing.seriesId);
        this.editScope.set('single');
        this.recurKey.set('none');
        this.showCustomRecur.set(false);
      } else {
        const start = this.state.formInitialStart();
        const dragged = this.state.formInitialEnd();
        // Kéo qua NHIỀU ô ngày ở lịch Tháng (khác ngày với start) -> sự kiện "Cả ngày" trải
        // đúng khoảng đã kéo. Phân biệt với kéo chọn GIỜ ở lịch Ngày/Tuần: trường hợp đó start
        // và dragged luôn cùng 1 ngày (chỉ kéo dọc trong 1 cột), nên không rơi vào nhánh này.
        const isMultiDayDrag = !!dragged && !isSameDay(start, dragged);
        this.tab.set(this.state.formInitialKind());
        this.title.set('');
        this.startDate.set(toDateInputValue(start));
        if (isMultiDayDrag) {
          this.startTime.set('00:00');
          this.endDate.set(toDateInputValue(dragged!));
          this.endTime.set('23:59');
          this.isAllDay.set(true);
        } else {
          // Kéo chọn khoảng giờ -> dùng đúng giờ kết thúc đã kéo; nếu không thì mặc định +1 tiếng.
          let end = dragged ?? new Date(start.getTime() + 60 * 60_000);
          // Sự kiện gói gọn trong 1 ngày: nếu +1 tiếng tràn sang ngày sau -> kẹp về 23:59 cùng ngày.
          if (end.getDate() !== start.getDate() || end.getMonth() !== start.getMonth() || end.getFullYear() !== start.getFullYear()) {
            end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59);
          }
          this.startTime.set(toTimeInputValue(start));
          this.endDate.set(toDateInputValue(end));
          this.endTime.set(toTimeInputValue(end));
          this.isAllDay.set(false);
        }
        this.location.set('');
        this.description.set('');
        this.guests.set([]);
        this.color.set('sky');
        this.recurKey.set('none');
        this.showCustomRecur.set(false);
        this.editingSeries.set(false);
        this.editScope.set('single');
        // Nhắc mặc định lấy từ Cài đặt (default_reminder) khi tạo mới; null = không có mốc nào.
        const def = this.settings.settings().default_reminder;
        this.reminders.set(def != null ? [minutesToItem(def)] : []);
        this.reminderMessage.set('');
      }
      this.guestEmailDraft.set('');
    }
  }

  private computedStart = computed(() => new Date(`${this.startDate()}T${this.startTime() || '00:00'}`));
  // Ngày kết thúc LUÔN bằng ngày bắt đầu — sự kiện gói gọn trong 1 ngày (chỉ chọn GIỜ kết thúc).
  private computedEnd = computed(() => new Date(`${this.startDate()}T${this.endTime() || '00:00'}`));

  conflicts = computed<CalendarEvent[]>(() => {
    if (this.tab() !== 'event' || this.isAllDay()) return [];
    const start = this.computedStart();
    const end = this.computedEnd();
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];
    return this.state.findConflicts(start, end, this.editingId ?? undefined);
  });

  formatRange(e: CalendarEvent): string {
    const fmt = (d: Date) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    return `${fmt(e.start)} – ${fmt(e.end)}`;
  }

  /** Gợi ý các email ĐÃ TỪNG mời (gom từ mọi event), khớp với chữ đang gõ, chưa nằm trong danh sách hiện tại */
  guestSuggestions = computed<string[]>(() => {
    const q = this.guestEmailDraft().trim().toLowerCase();
    if (!q) return [];
    const alreadyAdded = new Set(this.guests().map((g) => g.email.toLowerCase()));
    const seen = new Set<string>();
    const result: string[] = [];
    for (const ev of this.state.events()) {
      for (const g of ev.guests) {
        const key = g.email.toLowerCase();
        if (seen.has(key) || alreadyAdded.has(key)) continue;
        if (!key.includes(q)) continue;
        seen.add(key);
        result.push(g.email);
        if (result.length >= 6) return result;
      }
    }
    return result;
  });

  pickSuggestion(email: string): void {
    this.guestEmailDraft.set(email);
    this.addGuest();
  }

  addGuest(): void {
    const email = this.guestEmailDraft().trim();
    if (!email || !email.includes('@')) return;
    if (this.guests().some((g) => g.email.toLowerCase() === email.toLowerCase())) return;
    this.guests.update((list) => [...list, { email, status: 'needsAction', canEdit: false }]);
    this.guestEmailDraft.set('');
  }

  removeGuest(email: string): void {
    this.guests.update((list) => list.filter((g) => g.email !== email));
  }

  /** Đổi quyền của 1 khách: editor (chỉnh sửa) hay viewer (chỉ xem). */
  setGuestRole(email: string, canEdit: boolean): void {
    this.guests.update((list) => list.map((g) => (g.email === email ? { ...g, canEdit } : g)));
  }

  close(): void {
    this.state.closeForm();
  }

  /** Bấm Enter trong ô tiêu đề/địa điểm -> lưu luôn (như bấm nút Lưu). Tab "Lên lịch hẹn" không có nút Lưu nên bỏ qua. */
  protected onEnterSave(): void {
    if (this.tab() === 'appointment' || this.saving()) return;
    this.save();
  }

  save(): void {
    // Đang chờ lần lưu trước phản hồi -> bỏ qua, tránh bấm nhiều lần tạo trùng sự kiện
    // (đây chính là nguyên nhân sinh ra nhiều bản ghi trùng khi lưu bị chậm/lỗi mà form
    // không cho biết gì, khiến người dùng tưởng chưa bấm được nên bấm tiếp).
    if (this.saving()) return;

    const start = this.isAllDay() ? new Date(`${this.startDate()}T00:00`) : this.computedStart();
    // "Cả ngày" dùng đúng ngày kết thúc đã chọn (có thể trải nhiều ngày); ngày trống hoặc
    // trước ngày bắt đầu -> coi như gói gọn trong 1 ngày (giữ hành vi cũ làm mặc định an toàn).
    const endDateAllDay = this.endDate() && this.endDate() >= this.startDate() ? this.endDate() : this.startDate();
    const end = this.isAllDay() ? new Date(`${endDateAllDay}T23:59`) : this.computedEnd();

    // Chặn giờ/ngày kết thúc TRƯỚC bắt đầu: DB lưu bằng khoảng thời gian nên sẽ lỗi (500).
    // Báo rõ cho người dùng thay vì để "Lưu thất bại" khó hiểu.
    if (end.getTime() < start.getTime()) {
      this.formError.set(this.tr.t('form.endBeforeStart'));
      return;
    }

    // Chặn tràn qua ngày khác:
    //  - Sự kiện có giờ cụ thể: bắt buộc kết thúc CÙNG ngày với bắt đầu (view Tuần/Ngày chỉ
    //    vẽ trên cột ngày bắt đầu — tràn sang ngày sau sẽ bị cắt cụt, dễ hiểu nhầm).
    //  - Sự kiện "Cả ngày": cho phép nhiều ngày nhưng giới hạn tối đa 30 ngày để tránh
    //    tạo nhầm sự kiện kéo hàng năm chặn cả lịch.
    if (!this.isAllDay()) {
      const sameDay =
        start.getFullYear() === end.getFullYear() &&
        start.getMonth() === end.getMonth() &&
        start.getDate() === end.getDate();
      if (!sameDay) {
        this.formError.set(this.tr.t('form.crossDayNotAllowed'));
        return;
      }
    } else {
      const MAX_ALL_DAY_SPAN_DAYS = 31; // đủ chọn cả 1 tháng (kể cả tháng 31 ngày)
      const spanDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
      if (spanDays > MAX_ALL_DAY_SPAN_DAYS) {
        this.formError.set(this.tr.t('form.spanTooLong'));
        return;
      }
    }
    this.formError.set('');
    this.saving.set(true);

    // #24: Lặp khi TẠO MỚI, hoặc khi SỬA sự kiện CHƯA thuộc chuỗi (chọn lặp -> backend sinh chuỗi).
    // Sửa 1 mắt trong chuỗi -> không đổi luật lặp, chỉ chọn phạm vi (editScope).
    const isEdit = !!this.editingId;
    const recurrence = (!isEdit || !this.editingSeries()) ? this.buildRecurrence() : undefined;
    const editScope = (isEdit && this.editingSeries()) ? this.editScope() : undefined;

    this.state.saveEvent(
      {
        id: this.editingId ?? undefined,
        kind: this.tab(),
        title: this.title().trim(),
        description: this.description() || undefined,
        location: this.location() || undefined,
        start,
        end,
        isAllDay: this.isAllDay(),
        guests: this.guests(),
        color: this.color(),
        reminders: this.reminderMinutesList(),
        reminderMessage: this.reminderMessage().trim() || null,
      },
      recurrence,
      // Sau khi lưu xong (có id) -> upload các file đã đính kèm trong form.
      (event) => {
        if (this.stagedFiles().length > 0) this.uploadStaged(event.id);
      },
      // Lưu thất bại: KHÔNG đóng form (giữ nguyên tiêu đề/khách mời vừa nhập) + hiện lỗi
      // ngay trong modal, vì banner loadError ở trang chính bị modal che mất, người dùng
      // sẽ không thấy được.
      () => {
        this.saving.set(false);
        this.formError.set(this.tr.t('form.saveFailed'));
      },
      editScope,
    );
  }
}
