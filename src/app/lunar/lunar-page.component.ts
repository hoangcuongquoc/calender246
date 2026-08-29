// Trang Âm lịch — lịch tháng hiển thị song song ngày Dương và ngày Âm, kèm can chi
// và ngày lễ Việt Nam. Chỉ đọc (xem tra cứu), không tạo/sửa sự kiện ở đây.

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CalendarStateService } from '../calendar/calendar-state.service';
import { HolidaysService } from '../calendar/holidays.service';
import { SettingsService } from '../settings/settings.service';
import { TranslateService } from '../i18n/translate.service';
import { IconComponent } from '../shared/icon.component';
import { addMonths, isSameDay, orderedWeekdayLabels, startOfMonth, startOfWeek } from '../calendar/date-utils';
import { canChiDay, canChiMonth, canChiYear, solarToLunar } from './lunar.util';

interface LunarCell {
  date: Date;
  solarDay: number;
  lunarDay: number;
  lunarMonth: number;
  lunarLeap: boolean;
  inMonth: boolean;
  isToday: boolean;
  holiday: string | null;
  holidayPublic: boolean;
  /** true khi là mùng 1 âm lịch -> hiện "1/<tháng>" cho dễ nhận biết đầu tháng âm */
  isLunarMonthStart: boolean;
}

@Component({
  selector: 'app-lunar-page',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen bg-gray-50 text-gray-800">
      <header class="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <a routerLink="/" class="tap flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
          <app-icon name="arrow-back" class="h-5 w-5" /> {{ tr.t('settings.back') }}
        </a>
        <app-icon name="moon" class="h-5 w-5 text-amber-500" />
        <h1 class="text-lg font-medium">{{ tr.t('lunar.title') }}</h1>
      </header>

      <div class="mx-auto max-w-3xl space-y-4 p-4">
        <!-- Thẻ thông tin hôm nay -->
        <div class="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p class="text-sm text-amber-700">{{ tr.t('lunar.today') }} · {{ todaySolarLabel() }}</p>
          <p class="mt-1 text-2xl font-semibold text-amber-900">
            {{ tr.t('lunar.dayLabel') }} {{ today().day }}
            {{ tr.t('lunar.lunarMonth') }} {{ today().month }}@if (today().leap) { <span class="text-base font-normal">({{ tr.t('lunar.leap') }})</span> }
          </p>
          <p class="mt-1 text-sm text-amber-800">
            {{ tr.t('lunar.dayLabel') }} {{ todayCanChiDay() }} · {{ tr.t('lunar.monthLabel') }} {{ todayCanChiMonth() }} · {{ tr.t('lunar.yearLabel') }} {{ todayCanChiYear() }}
          </p>
        </div>

        <!-- Thanh điều hướng tháng -->
        <div class="flex items-center justify-between">
          <button type="button" (click)="prevMonth()" aria-label="Tháng trước" class="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900">
            <app-icon name="chevron-left" class="h-5 w-5" />
          </button>
          <div class="text-center">
            <p class="text-base font-medium">{{ monthLabel() }}</p>
            <button type="button" (click)="goToday()" class="text-xs text-blue-600">{{ tr.t('lunar.today') }}</button>
          </div>
          <button type="button" (click)="nextMonth()" aria-label="Tháng sau" class="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900">
            <app-icon name="chevron-right" class="h-5 w-5" />
          </button>
        </div>

        <!-- Lưới lịch -->
        <div class="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div class="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
            @for (w of weekdayLabels(); track w) {
              <div class="py-2 text-center text-xs font-medium text-gray-500">{{ w }}</div>
            }
          </div>
          <div class="grid grid-cols-7">
            @for (c of cells(); track c.date.getTime()) {
              <div
                class="relative min-h-16 border-b border-r border-gray-100 p-1.5"
                [class.bg-gray-50]="!c.inMonth"
              >
                <div class="flex items-baseline justify-between">
                  <span
                    class="text-sm font-medium"
                    [class.text-gray-300]="!c.inMonth"
                    [class.text-red-600]="c.inMonth && c.holidayPublic"
                    [class]="c.isToday ? 'flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white' : ''"
                  >{{ c.solarDay }}</span>
                  <span
                    class="text-[11px]"
                    [class.text-gray-300]="!c.inMonth"
                    [class.font-semibold]="c.isLunarMonthStart"
                    [class.text-amber-600]="c.inMonth && c.isLunarMonthStart"
                    [class.text-gray-400]="c.inMonth && !c.isLunarMonthStart"
                  >{{ c.isLunarMonthStart ? c.lunarDay + '/' + c.lunarMonth : c.lunarDay }}</span>
                </div>
                @if (c.holiday) {
                  <p class="mt-1 line-clamp-2 text-[10px] leading-tight" [class.text-red-600]="c.holidayPublic" [class.text-gray-500]="!c.holidayPublic">
                    {{ c.holiday }}
                  </p>
                }
              </div>
            }
          </div>
        </div>

        <!-- Chú thích -->
        <div class="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-gray-500">
          <span><span class="text-amber-600 font-semibold">1/8</span> = mùng 1 tháng 8 âm</span>
          <span><span class="text-red-600">■</span> ngày lễ / nghỉ chính thức</span>
        </div>
      </div>
    </div>
  `,
})
export class LunarPageComponent {
  protected readonly state = inject(CalendarStateService);
  protected readonly settings = inject(SettingsService);
  protected readonly tr = inject(TranslateService);
  private readonly holidays = inject(HolidaysService);

  /** Tháng đang xem (mốc = ngày 1 của tháng dương). */
  private readonly viewed = signal(startOfMonth(new Date()));

  protected readonly weekdayLabels = computed(() => orderedWeekdayLabels(this.settings.weekStartsOn()));

  protected readonly monthLabel = computed(() => {
    const d = this.viewed();
    return `${this.tr.t('lunar.monthLabel')} ${d.getMonth() + 1}/${d.getFullYear()}`;
  });

  /** Thông tin âm lịch của hôm nay. */
  protected readonly today = computed(() => {
    const now = new Date();
    return solarToLunar(now.getDate(), now.getMonth() + 1, now.getFullYear());
  });
  protected todaySolarLabel(): string {
    return this.settings.formatDate(new Date());
  }
  protected todayCanChiDay(): string {
    const n = new Date();
    return canChiDay(n.getDate(), n.getMonth() + 1, n.getFullYear());
  }
  protected todayCanChiMonth(): string {
    const t = this.today();
    return canChiMonth(t.month, t.year);
  }
  protected todayCanChiYear(): string {
    return canChiYear(this.today().year);
  }

  protected readonly cells = computed<LunarCell[]>(() => {
    const start = startOfWeek(startOfMonth(this.viewed()), this.settings.weekStartsOn());
    const month = this.viewed().getMonth();
    const today = new Date();
    const out: LunarCell[] = [];
    for (let i = 0; i < 42; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const lunar = solarToLunar(date.getDate(), date.getMonth() + 1, date.getFullYear());
      const holiday = this.holidays.get(date);
      out.push({
        date,
        solarDay: date.getDate(),
        lunarDay: lunar.day,
        lunarMonth: lunar.month,
        lunarLeap: lunar.leap,
        inMonth: date.getMonth() === month,
        isToday: isSameDay(date, today),
        holiday: holiday?.name ?? null,
        holidayPublic: holiday?.isPublic ?? false,
        isLunarMonthStart: lunar.day === 1,
      });
    }
    return out;
  });

  protected prevMonth(): void {
    this.viewed.set(addMonths(this.viewed(), -1));
  }
  protected nextMonth(): void {
    this.viewed.set(addMonths(this.viewed(), 1));
  }
  protected goToday(): void {
    this.viewed.set(startOfMonth(new Date()));
  }
}
