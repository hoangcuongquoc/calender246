// Trang Calendar chính — lắp ráp header, sidebar, khu vực view chính.
//
// CẬP NHẬT SO VỚI BẢN TRƯỚC: thêm banner nhỏ hiển thị lỗi tải dữ liệu (loadError)
// và cảnh báo trùng lịch do SERVER xác nhận sau khi lưu (lastSavedConflicts).

import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CalendarStateService } from './calendar-state.service';
import { GroupsStateService } from '../groups/groups-state.service';
import { GroupChatService } from '../groups/chat.service';
import { GroupPanelComponent } from '../groups/group-panel.component';
import { GroupsSectionComponent } from '../groups/groups-section.component';
import { MiniCalendarComponent } from './mini-calendar.component';
import { TimeGridViewComponent } from './time-grid-view.component';
import { MonthViewComponent } from './month-view.component';
import { YearViewComponent } from './year-view.component';
import { EventFormModalComponent } from './event-form-modal.component';
import { EventDetailPopoverComponent } from './event-detail-popover.component';
import { TrashModalComponent } from './trash-modal.component';
import { AiAssistantComponent } from '../ai/ai-assistant.component';
import { NotificationToastsComponent } from '../notifications/notification-toasts.component';
import { IconComponent } from '../shared/icon.component';
import { InvitationBellComponent } from './invitation-bell.component';
import { ThemeService } from '../theme.service';
import { SeasonalThemeService } from '../theme/seasonal-theme.service';
import { IcsService } from './ics.service';
import { PdfService } from './pdf.service';
import { AiApiService } from '../ai/ai-api.service';
import { CalendarEvent, EventKind, ViewMode } from './calendar.types';
import { addDays, startOfWeek } from './date-utils';
import { SupabaseService } from '../auth/supabase.service';
import { SettingsService } from '../settings/settings.service';
import { TranslateService } from '../i18n/translate.service';
import { SelectComponent, SelectOption } from '../shared/select.component';
import { LoadingScreenComponent } from '../shared/loading-screen.component';
import { AppStartupService } from '../shared/app-startup.service';

@Component({
  selector: 'app-calendar-page',
  standalone: true,
  imports: [
    MiniCalendarComponent,
    TimeGridViewComponent,
    MonthViewComponent,
    YearViewComponent,
    EventFormModalComponent,
    EventDetailPopoverComponent,
    TrashModalComponent,
    AiAssistantComponent,
    NotificationToastsComponent,
    IconComponent,
    GroupPanelComponent,
    GroupsSectionComponent,
    InvitationBellComponent,
    SelectComponent,
    FormsModule,
    RouterLink,
    LoadingScreenComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Lần mở app đầu tiên -> che toàn màn hình bằng loading page cho tới khi TẤT CẢ lệnh tải
         khởi động xong (sự kiện, lời mời, lịch chia sẻ, nhóm, cài đặt) — startup.isReady() chỉ
         chuyển true đúng 1 lần nên các lần reload() sau (RSVP, tạo sự kiện, realtime...) không
         che lại màn hình nữa. Thanh tiến trình trong app-loading-screen ăn theo startup.progress(). -->
    @if (!startup.isReady()) {
      <app-loading-screen />
    }
    <div class="flex h-screen flex-col bg-gray-50 text-gray-900">
      @if (state.loadError(); as msg) {
        <div class="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span class="flex items-center gap-2"><app-icon name="alert" class="h-4 w-4 shrink-0" />{{ msg }}</span>
          <button type="button" (click)="state.reload()" class="btn btn-secondary !py-1 !text-xs shrink-0">{{ tr.t('nav.retry') }}</button>
        </div>
      }
      @if (state.lastSavedConflicts().length > 0) {
        <div class="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span class="flex items-center gap-2">
            <app-icon name="alert" class="h-4 w-4 shrink-0" />
            {{ tr.t('nav.conflictWarn') }} {{ state.lastSavedConflicts().join(', ') }}
          </span>
          <button type="button" (click)="state.lastSavedConflicts.set([])" class="btn-icon !p-1 shrink-0" [attr.aria-label]="tr.t('common.close')"><app-icon name="x" class="h-4 w-4" /></button>
        </div>
      }
      @if (importMsg(); as msg) {
        <div class="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700">
          <span class="flex items-center gap-2"><app-icon name="inbox" class="h-4 w-4 shrink-0" />{{ msg }}</span>
          <button type="button" (click)="importMsg.set('')" class="btn-icon !p-1 shrink-0" [attr.aria-label]="tr.t('common.close')"><app-icon name="x" class="h-4 w-4" /></button>
        </div>
      }

      <!-- Top bar -->
      <header class="relative flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-200 px-4 py-2.5">
        <button
          type="button"
          (click)="sidebarOpen.set(!sidebarOpen())"
          class="btn-icon"
          [attr.aria-label]="tr.t('nav.toggleSidebar')"
          [title]="tr.t('nav.toggleSidebar')"
        >
          <app-icon name="menu" class="h-5 w-5 text-gray-600" />
        </button>
        <span class="flex items-center gap-2 text-lg font-semibold text-gray-800">
          <svg viewBox="0 0 32 32" class="h-7 w-7" aria-hidden="true">
            <rect x="9.2" y="3" width="2.6" height="6" rx="1.3" fill="var(--accent-600)"/>
            <rect x="20.2" y="3" width="2.6" height="6" rx="1.3" fill="var(--accent-600)"/>
            <rect x="3.5" y="6.5" width="25" height="22" rx="6" fill="var(--accent-600)"/>
            <rect x="3.5" y="6.5" width="25" height="6.5" rx="6" fill="var(--accent-500)"/>
            <g fill="#fff" opacity=".9">
              <rect x="7" y="16.4" width="3.6" height="3.6" rx="1.1"/>
              <rect x="14.2" y="16.4" width="3.6" height="3.6" rx="1.1"/>
              <rect x="21.4" y="16.4" width="3.6" height="3.6" rx="1.1"/>
              <rect x="7" y="21.8" width="3.6" height="3.6" rx="1.1"/>
              <rect x="21.4" y="21.8" width="3.6" height="3.6" rx="1.1"/>
            </g>
            <rect x="14.2" y="21.8" width="3.6" height="3.6" rx="1.1" fill="#dc2626"/>
          </svg>
          <span class="hidden sm:inline">{{ tr.t('nav.calendar') }}</span>
        </span>

        <!-- Cụm điều hướng ngày: Hôm nay + mũi tên, gom trong 1 nhóm để đỡ rời rạc -->
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            (click)="state.goToday()"
            class="btn btn-secondary !py-1.5"
          >{{ tr.t('nav.today') }}</button>

          <!-- Mũi tên lùi/tiến: viền + nền + mũi tên to & đậm màu để nhìn là biết bấm được -->
          <div class="flex items-center overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm">
            <button type="button" (click)="goPrev()" class="flex h-8 w-9 items-center justify-center text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700 active:bg-blue-100" [attr.aria-label]="tr.t('nav.prev')" [title]="tr.t('nav.prev')"><app-icon name="chevron-left" class="h-5 w-5" /></button>
            <div class="h-5 w-px bg-gray-300"></div>
            <button type="button" (click)="goNext()" class="flex h-8 w-9 items-center justify-center text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700 active:bg-blue-100" [attr.aria-label]="tr.t('nav.next')" [title]="tr.t('nav.next')"><app-icon name="chevron-right" class="h-5 w-5" /></button>
          </div>
        </div>

        <!-- Ô tìm kiếm sự kiện — đặt BÊN TRÁI, ngay sau cụm điều hướng ngày -->
        <div class="drop-anchor relative">
          <!-- Lớp neo RIÊNG cho icon kính lúp: .drop-anchor bị đặt static trên mobile
               (để panel kết quả neo theo header), nên icon phải có neo của chính nó. -->
          <div class="relative">
            <app-icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              [value]="searchQuery()"
              (input)="onSearchInput($event)"
              (focus)="searchFocused.set(true)"
              (blur)="onSearchBlur()"
              (keydown.escape)="clearSearch()"
              maxlength="100" [placeholder]="tr.t('nav.search')"
              class="field w-40 pl-8 sm:w-56"
            />
          </div>
          @if (searchFocused() && searchQuery().trim()) {
            <!-- Panel kết quả neo theo mép TRÁI vì ô tìm kiếm giờ nằm bên trái header -->
            <div class="drop-panel surface-panel popup-in absolute left-0 top-full z-40 mt-1.5 max-h-80 w-72 overflow-y-auto py-1 sm:w-80">
              @if (searchResults().length === 0) {
                <p class="px-3 py-2 text-sm text-gray-400">{{ tr.t('nav.searchNone') }}</p>
              } @else {
                @for (e of searchResults(); track e.id) {
                  <button
                    type="button"
                    (click)="goToSearchResult(e)"
                    class="block w-full rounded-[calc(var(--radius-md)-4px)] px-3 py-2 text-left hover:bg-gray-50"
                  >
                    <span class="block truncate text-sm font-medium text-gray-800">{{ e.title || tr.t('common.untitled') }}</span>
                    <span class="block truncate text-xs text-gray-500">{{ resultDateLabel(e) }}</span>
                  </button>
                }
              }
            </div>
          }
        </div>

        <!-- Chuông thông báo lời mời (Đồng ý/Từ chối ngay trong app) -->
        <app-invitation-bell />

        @if (seasonal.effectiveSeason(); as season) {
          <span class="hidden items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 sm:inline-flex" [title]="season.when">
            {{ season.emoji }} {{ season.name }}
          </span>
        }

        @if (state.isLoading()) {
          <span class="flex items-center gap-1.5 text-xs text-gray-400">
            <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400"></span>
            {{ tr.t('nav.loading') }}
          </span>
        }

        <!-- flex-wrap: cụm này gom tiêu đề + bánh răng + bộ chọn view + avatar. Không cho xuống
             dòng thì trên máy hẹp (≤360px) nó tràn ra ngoài mép phải và avatar bị cắt. -->
        <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
          <!-- Tiêu đề tháng/năm đặt ở BÊN PHẢI, ngay trước cụm công cụ.
               Header có flex-wrap nên màn hình hẹp sẽ tự xuống dòng, không bị chèn ép. -->
          <h1 class="whitespace-nowrap text-lg font-medium text-gray-800 sm:text-xl">{{ headerLabel() }}</h1>
          <div class="h-5 w-px bg-gray-300"></div>

          <!-- Nút bật sáng/tối đã chuyển vào Cài đặt → Giao diện cho gọn header. -->

          <!-- Bánh răng: gom công cụ Xuất/Nhập .ics + Thùng rác -->
          <div class="drop-anchor relative">
            <button
              type="button"
              (click)="settingsMenuOpen.set(!settingsMenuOpen())"
              class="btn-icon"
              [title]="tr.t('nav.tools')"
              [attr.aria-label]="tr.t('nav.tools')"
            >
              <app-icon name="dots" class="h-5 w-5 text-gray-600" />
            </button>
            @if (settingsMenuOpen()) {
              <!-- Lớp nền trong suốt: bấm ra ngoài để đóng menu -->
              <div class="fixed inset-0 z-20" (click)="settingsMenuOpen.set(false)"></div>
              <div class="drop-panel surface-panel popup-in absolute right-0 top-full z-30 mt-1.5 w-52 py-1">
                <button type="button" (click)="formatMenuOpen.set('ics'); settingsMenuOpen.set(false)" class="tap flex w-full items-center gap-2.5 rounded-[calc(var(--radius-md)-4px)] px-3 py-2.5 text-left text-sm hover:bg-gray-50">
                  <app-icon name="notes" class="h-4 w-4 text-gray-500" /> {{ tr.t('nav.formatIcs') }}
                </button>
                <button type="button" (click)="formatMenuOpen.set('pdf'); settingsMenuOpen.set(false)" class="tap flex w-full items-center gap-2.5 rounded-[calc(var(--radius-md)-4px)] px-3 py-2.5 text-left text-sm hover:bg-gray-50">
                  <app-icon name="notes" class="h-4 w-4 text-gray-500" /> {{ tr.t('nav.formatPdf') }}
                </button>
                <div class="my-1 border-t border-gray-200"></div>
                <button type="button" (click)="state.openTrash(); settingsMenuOpen.set(false)" class="tap flex w-full items-center gap-2.5 rounded-[calc(var(--radius-md)-4px)] px-3 py-2.5 text-left text-sm hover:bg-gray-50">
                  <app-icon name="trash" class="h-4 w-4 text-gray-500" /> {{ tr.t('nav.trash') }}
                </button>
                <a routerLink="/tasks" (click)="settingsMenuOpen.set(false)" class="tap flex w-full items-center gap-2.5 rounded-[calc(var(--radius-md)-4px)] px-3 py-2.5 text-left text-sm hover:bg-gray-50">
                  <app-icon name="check" class="h-4 w-4 text-gray-500" /> {{ tr.t('nav.tasks') }}
                </a>
                <a routerLink="/am-lich" (click)="settingsMenuOpen.set(false)" class="tap flex w-full items-center gap-2.5 rounded-[calc(var(--radius-md)-4px)] px-3 py-2.5 text-left text-sm hover:bg-gray-50">
                  <app-icon name="moon" class="h-4 w-4 text-gray-500" /> {{ tr.t('nav.lunar') }}
                </a>
                <a routerLink="/notes" (click)="settingsMenuOpen.set(false)" class="tap flex w-full items-center gap-2.5 rounded-[calc(var(--radius-md)-4px)] px-3 py-2.5 text-left text-sm hover:bg-gray-50">
                  <app-icon name="notes" class="h-4 w-4 text-gray-500" /> {{ tr.t('nav.notes') }}
                </a>
                <a routerLink="/invitations" (click)="settingsMenuOpen.set(false)" class="tap flex w-full items-center gap-2.5 rounded-[calc(var(--radius-md)-4px)] px-3 py-2.5 text-left text-sm hover:bg-gray-50">
                  <app-icon name="mail" class="h-4 w-4 text-gray-500" /> {{ tr.t('nav.invitations') }}
                </a>
                <a routerLink="/notification-history" (click)="settingsMenuOpen.set(false)" class="tap flex w-full items-center gap-2.5 rounded-[calc(var(--radius-md)-4px)] px-3 py-2.5 text-left text-sm hover:bg-gray-50">
                  <app-icon name="bell" class="h-4 w-4 text-gray-500" /> {{ tr.t('nav.notifHistory') }}
                </a>
                <a routerLink="/settings" (click)="settingsMenuOpen.set(false)" class="tap flex w-full items-center gap-2.5 rounded-[calc(var(--radius-md)-4px)] px-3 py-2.5 text-left text-sm hover:bg-gray-50">
                  <app-icon name="settings" class="h-4 w-4 text-gray-500" /> {{ tr.t('nav.settings') }}
                </a>
              </div>
            }
            <!-- multiple: chọn được NHIỀU file một lần, sự kiện của các file được gom lại rồi nhập chung -->
            <input #fileInput type="file" multiple accept=".ics,text/calendar" class="hidden" (change)="onImportFile($event); settingsMenuOpen.set(false)" />
            <input #fileInputPdf type="file" multiple accept=".pdf,application/pdf" class="hidden" (change)="onImportPdfFile($event); settingsMenuOpen.set(false)" />
          </div>

          <!-- Bộ chọn view dạng segmented (thay <select> gốc) — vẫn gọi đúng state.setViewMode(),
               chỉ đổi cách trình bày thành các nút liền khối rõ ràng hơn dropdown thu gọn. -->
          <div class="hidden items-center gap-0.5 rounded-md bg-black/5 p-0.5 dark:bg-white/10 sm:flex">
            @for (v of viewOptions; track v.value) {
              <button
                type="button"
                (click)="state.setViewMode(v.value)"
                class="rounded px-2.5 py-1 text-sm font-medium transition-colors"
                [class]="state.viewMode() === v.value ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'"
              >{{ tr.t(v.key) }}</button>
            }
          </div>
          <!-- Mobile: app-select gọn diện tích thay <select> gốc, vẫn gọi đúng state.setViewMode() -->
          <app-select
            class="w-24 !py-1.5 sm:hidden"
            [options]="viewSelectOptions()"
            [ngModel]="state.viewMode()"
            (ngModelChange)="state.setViewMode($any($event))"
          />

          @if (supabase.user(); as user) {
            <!-- Bấm vào khu vực tài khoản (ảnh đại diện) -> mở dropdown nhỏ có nút Đăng xuất,
                 thay vì đăng xuất ngay (tránh bấm nhầm) và thay vì để riêng icon logout rời. -->
            <div class="drop-anchor relative border-l border-gray-200 pl-2">
              <button
                type="button"
                (click)="accountMenuOpen.set(!accountMenuOpen())"
                class="tap flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-gray-100"
                [title]="displayLabel(user)"
              >
                @if (avatarUrl(user); as pic) {
                  <img [src]="pic" alt="avatar" referrerpolicy="no-referrer" class="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-gray-200" />
                } @else {
                  <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-600 text-xs font-semibold text-white">{{ userInitial(user) }}</span>
                }
                @if (displayLabel(user); as label) {
                  <span class="hidden text-sm text-gray-500 md:inline">{{ label }}</span>
                }
              </button>
              @if (accountMenuOpen()) {
                <div class="fixed inset-0 z-20" (click)="accountMenuOpen.set(false)"></div>
                <div class="drop-panel surface-panel popup-in absolute right-0 top-full z-30 mt-1.5 w-48 py-1">
                  @if (displayLabel(user); as label) {
                    <p class="truncate px-3 py-1.5 text-sm font-medium text-gray-800">{{ label }}</p>
                  }
                  @if (user.email) {
                    <p class="truncate px-3 pb-2 text-xs text-gray-500">{{ user.email }}</p>
                  }
                  <div class="border-t border-gray-200"></div>
                  <button type="button" (click)="logout()" class="tap flex w-full items-center gap-2.5 rounded-[calc(var(--radius-md)-4px)] px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50">
                    <app-icon name="logout" class="h-4 w-4" /> {{ tr.t('priv.logout') }}
                  </button>
                </div>
              }
            </div>
          }
        </div>
      </header>

      <div class="relative flex flex-1 overflow-hidden">
        <!-- Nền mờ khi mở sidebar trên MOBILE: bấm ra ngoài để đóng (ẩn trên desktop) -->
        @if (sidebarOpen()) {
          <div class="absolute inset-0 z-20 bg-black/30 md:hidden" (click)="sidebarOpen.set(false)"></div>
        }
        <!-- Sidebar (trượt mượt khi ẩn/hiện bằng nút 3 gạch ở header) -->
        <aside
          class="sidebar-panel shrink-0 overflow-y-auto border-r border-gray-200"
          [class.sidebar-collapsed]="!sidebarOpen()"
        >
          <div class="relative mb-5">
            <button
              type="button"
              (click)="createMenuOpen.set(!createMenuOpen())"
              class="btn btn-primary w-full !justify-start !rounded-full !py-2.5 !pl-3.5"
            >
              <app-icon name="plus" class="h-5 w-5" /> {{ tr.t('nav.create') }}
            </button>

            @if (createMenuOpen()) {
              <!-- Lớp nền trong suốt: bấm ra ngoài để đóng menu (khớp mẫu settingsMenuOpen/
                   accountMenuOpen) — thiếu lớp này khiến menu có thể còn mở ngầm phía sau khi
                   bấm thẳng sang mở panel khác (vd 1 nhóm), tràn lên trên panel đó. -->
              <div class="fixed inset-0 z-20" (click)="createMenuOpen.set(false)"></div>
              <div class="surface-panel popup-in absolute left-0 top-full z-30 mt-1.5 w-44 py-1">
                <button type="button" (click)="openCreate('event')" class="flex w-full items-center gap-2 rounded-[calc(var(--radius-md)-4px)] px-3 py-2.5 text-left text-sm hover:bg-gray-50">{{ tr.t('kind.event') }}</button>
                <button type="button" (click)="openCreate('task')" class="flex w-full items-center gap-2 rounded-[calc(var(--radius-md)-4px)] px-3 py-2.5 text-left text-sm hover:bg-gray-50">{{ tr.t('kind.task') }}</button>
                <button type="button" (click)="openCreate('appointment')" class="flex w-full items-center gap-2 rounded-[calc(var(--radius-md)-4px)] px-3 py-2.5 text-left text-sm hover:bg-gray-50">{{ tr.t('kind.appointment') }}</button>
              </div>
            }
          </div>

          <!-- Nhóm lên lịch cùng nhau — đặt NGAY DƯỚI nút "+ Tạo" cho dễ thấy, khỏi cuộn
               xuống cuối sidebar. (Mobile: dùng nút nổi riêng ở góc phải, xem bên dưới.) -->
          <div class="mb-5 hidden border-b border-gray-200 pb-4 md:block">
            <p class="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Nhóm</p>
            <app-groups-section />
          </div>

          <app-mini-calendar [viewedDate]="state.viewedDate()" (dateSelected)="onMiniCalendarPick($event)" />

          <div class="mt-6 border-t border-gray-200 pt-4">
            <p class="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{{ tr.t('nav.show') }}</p>
            <ul class="space-y-0.5 text-sm text-gray-700">
              <!-- Không còn chấm màu cố định theo loại: màu giờ do người tạo tự chọn cho từng sự kiện. -->
              <li>
                <label class="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-gray-100">
                  <input type="checkbox" [checked]="state.visibleKinds().event" (change)="state.toggleKind('event')" class="h-3.5 w-3.5 accent-blue-600" />
                  {{ tr.t('kind.event') }}
                </label>
              </li>
              <li>
                <label class="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-gray-100">
                  <input type="checkbox" [checked]="state.visibleKinds().task" (change)="state.toggleKind('task')" class="h-3.5 w-3.5 accent-blue-600" />
                  {{ tr.t('kind.task') }}
                </label>
              </li>
              <li>
                <label class="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-gray-100">
                  <input type="checkbox" [checked]="state.visibleKinds().appointment" (change)="state.toggleKind('appointment')" class="h-3.5 w-3.5 accent-blue-600" />
                  {{ tr.t('kind.appointment') }}
                </label>
              </li>
            </ul>
          </div>

        </aside>

        <!-- Main view -->
        <main class="flex-1 overflow-hidden">
          <!-- Bọc trong @for keyed theo view+ngày: mỗi lần đổi -> DOM tạo lại -> chạy animation .view-fade -->
          @for (key of [transitionKey()]; track key) {
            <div class="view-fade h-full" [class.view-fade-back]="slideDir() === 'back'">
              @switch (state.viewMode()) {
                @case ('day') {
                  <app-time-grid-view
                    [dates]="[state.viewedDate()]"
                    [events]="mergedEvents()"
                    (slotClicked)="onSlotClicked($event)"
                    (rangeSelected)="onRangeSelected($event)"
                    (eventClicked)="onEventClicked($event)"
                    (eventTimesChanged)="onEventTimesChanged($event)"
                    (dateSelected)="onDayHeaderClicked($event)"
                  />
                }
                @case ('week') {
                  <app-time-grid-view
                    [dates]="weekDates()"
                    [events]="mergedEvents()"
                    (slotClicked)="onSlotClicked($event)"
                    (rangeSelected)="onRangeSelected($event)"
                    (eventClicked)="onEventClicked($event)"
                    (eventTimesChanged)="onEventTimesChanged($event)"
                    (dateSelected)="onDayHeaderClicked($event)"
                  />
                }
                @case ('month') {
                  <app-month-view
                    [viewedDate]="state.viewedDate()"
                    [events]="mergedEvents()"
                    (dateClicked)="onMonthDateClicked($event)"
                    (eventClicked)="onEventClicked($event)"
                    (rangeSelected)="onMonthRangeSelected($event)"
                  />
                }
                @case ('year') {
                  <app-year-view [viewedDate]="state.viewedDate()" [events]="mergedEvents()" (dateClicked)="onYearDateClicked($event)" />
                }
              }
            </div>
          }
        </main>
      </div>
    </div>

    @if (state.isFormOpen()) {
      <app-event-form-modal />
    }
    @if (state.selectedEventId()) {
      <app-event-detail-popover />
    }
    @if (state.isTrashOpen()) {
      <app-trash-modal />
    }

    <!-- Chọn Nhập/Xuất cho 1 định dạng (ICS hoặc PDF) — gộp 4 mục menu cũ thành 2, bấm vào
         mới hỏi rõ Nhập hay Xuất để đỡ rối, hiện giữa màn hình để không lẫn với menu thả xuống. -->
    @if (formatMenuOpen(); as fmt) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" (click)="formatMenuOpen.set(null)">
        <div class="surface-panel popup-in w-full max-w-xs !rounded-[var(--radius-lg)] p-5 !shadow-[var(--shadow-lg)]" (click)="$event.stopPropagation()">
          <div class="mb-4 flex items-start justify-between gap-2">
            <div>
              <h3 class="text-base font-semibold text-gray-900">{{ fmt === 'ics' ? tr.t('nav.formatIcs') : tr.t('nav.formatPdf') }}</h3>
              <p class="mt-0.5 text-xs text-gray-500">{{ tr.t('nav.formatPickHint') }} {{ fmt === 'ics' ? tr.t('nav.formatIcs') : tr.t('nav.formatPdf') }}</p>
            </div>
            <button type="button" (click)="formatMenuOpen.set(null)" class="btn-icon !p-1.5" [attr.aria-label]="tr.t('common.close')"><app-icon name="x" class="h-4 w-4" /></button>
          </div>
          <div class="flex flex-col gap-2">
            <button type="button" (click)="fmt === 'ics' ? onExport() : onExportPdf(); formatMenuOpen.set(null)" class="tap btn btn-secondary w-full !justify-start gap-2.5">
              <app-icon name="download" class="h-4 w-4" /> {{ tr.t('nav.exportAction') }}
            </button>
            <button
              type="button"
              [disabled]="fmt === 'pdf' && pdfBusy()"
              (click)="(fmt === 'ics' ? fileInput : fileInputPdf).click(); formatMenuOpen.set(null)"
              class="tap btn btn-secondary w-full !justify-start gap-2.5 disabled:opacity-50"
            >
              <app-icon name="upload" class="h-4 w-4" /> {{ fmt === 'pdf' && pdfBusy() ? tr.t('nav.importPdfBusy') : tr.t('nav.importAction') }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (settings.settings().ai_settings.enabled) {
      <app-ai-assistant />
    }

    <!-- MOBILE: Nhóm có nút nổi riêng (giống trợ lý AI) vì sidebar trên điện thoại
         phải cuộn xuống tận cuối mới thấy. Đặt phía trên nút AI để không đè nhau. -->
    @if (!groupsMobileOpen()) {
      <button
        type="button"
        (click)="groupsMobileOpen.set(true)"
        class="tap fixed bottom-6 left-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-violet-600 text-2xl text-white shadow-[var(--shadow-lg)] hover:bg-violet-700 md:hidden"
        aria-label="Nhóm"
      >
        👥
        @if (chat.totalUnread() > 0) {
          <span class="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-white">{{ chat.totalUnread() > 9 ? '9+' : chat.totalUnread() }}</span>
        }
      </button>
    } @else {
      <div class="fixed inset-0 z-40 md:hidden" (click)="groupsMobileOpen.set(false)">
        <div class="absolute inset-0 bg-black/30"></div>
        <!-- Đặt Ở TRÊN (không phải đáy màn) cho dễ nhìn + dễ với tay đọc -->
        <div class="surface-panel popup-in groups-lg absolute inset-x-3 top-3 max-h-[82vh] overflow-y-auto !rounded-[var(--radius-lg)] p-5 !shadow-[var(--shadow-lg)]" (click)="$event.stopPropagation()">
          <div class="mb-4 flex items-center justify-between">
            <span class="flex items-center gap-2 text-lg font-semibold text-gray-800">👥 Nhóm</span>
            <button type="button" (click)="groupsMobileOpen.set(false)" class="btn-icon" [attr.aria-label]="tr.t('common.close')">
              <app-icon name="x" class="h-5 w-5" />
            </button>
          </div>
          <app-groups-section (opened)="groupsMobileOpen.set(false)" />
        </div>
      </div>
    }

    <app-notification-toasts />

    @if (groupsState.panelGroupId()) {
      <app-group-panel />
    }
    @if (groupsState.flash(); as msg) {
      <div class="popup-in fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-[var(--shadow-md)]">
        <span>👥</span> {{ msg }}
      </div>
    }
  `,
})
export class CalendarPageComponent implements OnInit {
  protected readonly state = inject(CalendarStateService);
  protected readonly startup = inject(AppStartupService);
  protected readonly groupsState = inject(GroupsStateService);
  protected readonly chat = inject(GroupChatService);
  protected readonly supabase = inject(SupabaseService);
  protected readonly theme = inject(ThemeService);
  protected readonly seasonal = inject(SeasonalThemeService);
  protected readonly settings = inject(SettingsService);
  protected readonly tr = inject(TranslateService);
  private readonly ics = inject(IcsService);
  private readonly pdf = inject(PdfService);
  private readonly aiApi = inject(AiApiService);
  /** Danh sách view cho bộ chọn dạng segmented ở header (desktop). */
  protected readonly viewOptions: { value: ViewMode; key: string }[] = [
    { value: 'day', key: 'view.day' },
    { value: 'week', key: 'view.week' },
    { value: 'month', key: 'view.month' },
    { value: 'year', key: 'view.year' },
  ];
  /** app-select (mobile) cần shape {value,label} — map lại từ viewOptions. */
  protected readonly viewSelectOptions = computed<SelectOption[]>(() =>
    this.viewOptions.map((v) => ({ value: v.value, label: this.tr.t(v.key) })),
  );
  protected readonly createMenuOpen = signal(false);
  // Mặc định: MỞ trên desktop, ĐÓNG trên mobile (<768px) để lịch có full bề rộng khi mở app.
  protected readonly sidebarOpen = signal(typeof window === 'undefined' || window.innerWidth >= 768);
  /** Panel "Nhóm" nổi trên mobile (desktop dùng khối trong sidebar). */
  protected readonly groupsMobileOpen = signal(false);
  protected readonly settingsMenuOpen = signal(false);
  protected readonly accountMenuOpen = signal(false);
  /** Popup giữa màn hình hỏi Nhập/Xuất cho 1 định dạng — null = đang đóng. */
  protected readonly formatMenuOpen = signal<'ics' | 'pdf' | null>(null);
  /** Hướng chuyển view gần nhất — quyết định animation trượt vào từ trái (back) hay phải (fwd). */
  protected readonly slideDir = signal<'fwd' | 'back'>('fwd');
  goPrev(): void {
    this.slideDir.set('back');
    this.state.goPrev();
  }
  goNext(): void {
    this.slideDir.set('fwd');
    this.state.goNext();
  }
  protected readonly importMsg = signal('');
  /** true khi đang trích chữ từ PDF + chờ AI nhận diện sự kiện (Nhập PDF) — thao tác này chậm hơn .ics nhiều. */
  protected readonly pdfBusy = signal(false);

  /** Sự kiện hiển thị trên lịch = sự kiện cá nhân (đã lọc) + sự kiện của các nhóm đang hiện */
  protected readonly mergedEvents = computed<CalendarEvent[]>(() => [
    ...this.state.visibleEvents(),
    ...this.groupsState.visibleGroupEvents(),
  ]);

  ngOnInit(): void {
    // Khởi động tính năng nhóm: đồng bộ lời mời, tải nhóm, kết nối WebSocket.
    this.groupsState.start();
    // Nạp số tin nhắn chưa đọc để hiện badge ở sidebar.
    this.chat.loadUnread();
    // Nếu mở bằng link mời (?join=CODE) -> tự tham gia nhóm rồi dọn URL.
    const params = new URLSearchParams(window.location.search);
    const code = params.get('join');
    if (code) {
      this.groupsState.joinByCode(code);
      history.replaceState(null, '', window.location.pathname);
    }
  }

  // (Danh sách nhóm / tạo nhóm / tham gia bằng mã đã chuyển sang GroupsSectionComponent
  //  để dùng chung cho sidebar desktop và panel nổi trên mobile.)

  onExport(): void {
    this.ics.exportToFile(this.state.events());
  }

  async onExportPdf(): Promise<void> {
    try {
      await this.pdf.exportToFile(this.state.events());
    } catch (e) {
      const detail = e instanceof Error ? e.message : '';
      this.importMsg.set(detail ? `Xuất PDF thất bại: ${detail}` : 'Xuất PDF thất bại.');
    }
  }

  /** Nhập .ics — chọn được NHIỀU file, gom sự kiện của tất cả rồi nhập một lượt. */
  async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // cho phép chọn lại đúng những file đó lần sau
    if (files.length === 0) return;

    const all: { title: string; start: Date; end: Date; isAllDay: boolean; description?: string; location?: string }[] = [];
    const failed: string[] = [];

    for (const file of files) {
      try {
        const text = await file.text();
        all.push(...this.ics.parse(text));
      } catch {
        // 1 file hỏng KHÔNG làm hỏng cả mẻ — ghi tên lại để báo, các file khác vẫn nhập.
        failed.push(file.name);
      }
    }

    if (failed.length > 0 && all.length === 0) {
      this.importMsg.set(`File .ics không hợp lệ: ${failed.join(', ')}`);
      return;
    }
    this.applyImportedEvents(all, 'File .ics không hợp lệ.');
    if (failed.length > 0) {
      this.importMsg.update((m) => `${m} (bỏ qua file lỗi: ${failed.join(', ')})`);
    }
  }

  /** Nhập từ file PDF bất kỳ: trích chữ (pdfjs) -> AI nhận diện sự kiện -> lưu như luồng nhập .ics. */
  async onImportPdfFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;

    this.pdfBusy.set(true);
    const all: { title: string; start: Date; end: Date; isAllDay: boolean; description?: string; location?: string }[] = [];
    const failed: string[] = [];
    let lastReply = '';

    // Xử lý TUẦN TỰ chứ không song song: mỗi file là 1 lượt gọi AI, bắn cùng lúc dễ bị
    // giới hạn tần suất và làm máy yếu đứng hình khi trích chữ nhiều PDF.
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      this.importMsg.set(
        files.length > 1
          ? `Đang đọc PDF ${i + 1}/${files.length} (${file.name}) và nhờ AI nhận diện sự kiện...`
          : 'Đang đọc PDF và nhờ AI nhận diện sự kiện...',
      );
      try {
        const text = await this.pdf.extractText(file);
        if (!text.trim()) {
          failed.push(file.name);
          continue;
        }
        const result = await new Promise<{ events: { title: string; startTime: string; endTime: string; isAllDay?: boolean; location?: string; description?: string }[]; reply: string }>(
          (resolve, reject) => this.aiApi.extractEvents(text).subscribe({ next: resolve, error: reject }),
        );
        lastReply = result.reply || lastReply;
        all.push(
          ...result.events.map((e) => ({
            title: e.title,
            start: new Date(e.startTime),
            end: new Date(e.endTime),
            isAllDay: !!e.isAllDay,
            description: e.description,
            location: e.location,
          })),
        );
      } catch {
        failed.push(file.name); // file này hỏng thì bỏ qua, các file còn lại vẫn chạy tiếp
      }
    }

    this.pdfBusy.set(false);

    if (all.length === 0) {
      this.importMsg.set(
        failed.length ? `Không xử lý được: ${failed.join(', ')}` : lastReply || 'Không tìm thấy sự kiện nào trong file.',
      );
      return;
    }
    this.applyImportedEvents(all, 'Nhập PDF thất bại.');
    if (failed.length > 0) {
      this.importMsg.update((m) => `${m} (bỏ qua file lỗi: ${failed.join(', ')})`);
    }
  }

  /** Dùng chung cho luồng Nhập .ics và Nhập PDF: tạo từng event, tô nổi bật sau khi lưu xong. */
  private applyImportedEvents(
    imported: { title: string; start: Date; end: Date; isAllDay: boolean; description?: string; location?: string }[],
    emptyMsg: string,
  ): void {
    if (imported.length === 0) {
      this.importMsg.set(emptyMsg);
      return;
    }
    // Thu thập id các sự kiện MỚI tạo để tô nổi bật sau khi lưu xong.
    const newIds: string[] = [];
    for (const ev of imported) {
      this.state.saveEvent(
        {
          kind: 'event',
          title: ev.title,
          description: ev.description,
          location: ev.location,
          start: ev.start,
          end: ev.end,
          isAllDay: ev.isAllDay,
          guests: [],
          color: 'sky',
        },
        undefined,
        // afterSave: gom id; khi gom đủ -> nhảy tới ngày sớm nhất + highlight.
        (saved) => {
          newIds.push(saved.id);
          if (newIds.length === imported.length) {
            const earliest = imported.reduce((a, b) => (a.start < b.start ? a : b)).start;
            this.state.viewedDate.set(earliest);
            this.state.highlightEvents(newIds);
          }
        },
      );
    }
    this.importMsg.set(`Đã nhập ${imported.length} sự kiện.`);
  }

  // ----- Tìm kiếm sự kiện -----
  protected readonly searchQuery = signal('');
  protected readonly searchFocused = signal(false);

  /** Lọc sự kiện theo tiêu đề / mô tả / địa điểm (không phân biệt hoa thường), gần nhất lên trước */
  protected readonly searchResults = computed<CalendarEvent[]>(() => {
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return [];
    return this.state
      .events()
      .filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (e.description ?? '').toLowerCase().includes(q) ||
          (e.location ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .slice(0, 20);
  });

  onSearchInput(ev: Event): void {
    this.searchQuery.set((ev.target as HTMLInputElement).value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.searchFocused.set(false);
  }

  /** Đóng dropdown sau khi rời ô input — trễ 1 chút để kịp bắt cú click vào kết quả */
  onSearchBlur(): void {
    setTimeout(() => this.searchFocused.set(false), 150);
  }

  /** Bấm 1 kết quả -> nhảy tới ngày của sự kiện (view Ngày) rồi mở popover chi tiết */
  goToSearchResult(e: CalendarEvent): void {
    this.state.selectDate(e.start, true);
    this.state.selectEvent(e.id);
    this.clearSearch();
  }

  resultDateLabel(e: CalendarEvent): string {
    const date = e.start.toLocaleDateString('vi-VN', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });
    if (e.isAllDay) return `${date} · Cả ngày`;
    const time = e.start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    return `${date} · ${time}`;
  }

  weekDates = computed(() => {
    const start = startOfWeek(this.state.viewedDate(), this.settings.weekStartsOn());
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    // Ẩn cuối tuần trong view Tuần nếu người dùng tắt "Hiện cuối tuần".
    return this.settings.settings().show_weekends
      ? days
      : days.filter((d) => d.getDay() !== 0 && d.getDay() !== 6);
  });

  /** Khóa đổi mỗi khi đổi view hoặc đổi ngày đang xem -> kích hoạt lại animation chuyển trang */
  transitionKey = computed(() => `${this.state.viewMode()}:${this.state.viewedDate().getTime()}`);

  headerLabel = computed(() => {
    const d = this.state.viewedDate();
    if (this.state.viewMode() === 'year') return `${d.getFullYear()}`;
    return `${this.tr.monthLong(d.getMonth())}, ${d.getFullYear()}`;
  });


  onMiniCalendarPick(date: Date): void {
    this.state.selectDate(date, true);
  }

  /** Màn hình nhỏ (<768px): ô ngày rất bé, khó bấm trúng -> đi TỪNG CẤP thay vì nhảy thẳng. */
  private isMobile(): boolean {
    return typeof window !== 'undefined' && window.innerWidth < 768;
  }

  /**
   * Bấm vào chỗ TRỐNG của một ô ngày ở lịch Tháng -> mở luôn form tạo sự kiện cho đúng
   * ngày đó, KHÔNG nhảy sang view Ngày/Tuần nữa. Muốn sửa sự kiện có sẵn thì bấm thẳng
   * vào chip sự kiện (đã có onEventClicked lo).
   * Ô ngày mang mốc 00:00 -> đặt giờ mặc định 08:00 cho hợp lý.
   */
  onMonthDateClicked(date: Date): void {
    this.state.selectDate(date, false);
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 8, 0, 0, 0);
    this.state.openCreateForm('event', start);
  }

  /** Kéo chọn nhiều ô ngày ở lịch Tháng -> mở form tạo với sự kiện "Cả ngày" trải đúng khoảng đã kéo. */
  onMonthRangeSelected(range: { start: Date; end: Date }): void {
    this.state.selectDate(range.start, false);
    this.state.openCreateForm('event', range.start, range.end);
  }

  /** Bấm ngày ở header lưới giờ -> chuyển sang view Ngày của ngày đó */
  onDayHeaderClicked(date: Date): void {
    this.state.selectDate(date, true);
  }

  onYearDateClicked(date: Date): void {
    // Mobile: Năm -> Tháng (rồi Tuần, rồi Ngày). Desktop: vào thẳng Ngày như cũ.
    this.state.selectDate(date, false);
    this.state.viewMode.set(this.isMobile() ? 'month' : 'day');
  }

  onSlotClicked(start: Date): void {
    this.state.openCreateForm('event', start);
  }

  /** Kéo chọn 1 khoảng giờ trên lịch ngày/tuần -> mở form tạo với đúng giờ bắt đầu + kết thúc. */
  onRangeSelected(range: { start: Date; end: Date }): void {
    this.state.openCreateForm('event', range.start, range.end);
  }

  onEventClicked(event: CalendarEvent): void {
    // Sự kiện nhóm -> mở panel nhóm; sự kiện cá nhân -> popover chi tiết như cũ
    if (event.groupId) {
      this.groupsState.openPanel(event.groupId);
    } else {
      this.state.selectEvent(event.id);
    }
  }

  /** Người dùng kéo co giãn 1 sự kiện xong -> lưu giờ mới (optimistic, không giật) */
  onEventTimesChanged(event: CalendarEvent): void {
    if (event.groupId) {
      this.groupsState.updateGroupEventTimes(event);
    } else {
      this.state.updateEventTimes(event);
    }
  }

  openCreate(kind: EventKind): void {
    this.createMenuOpen.set(false);
    this.state.openCreateForm(kind, this.state.viewedDate());
  }

  /** URL ảnh đại diện từ tài khoản Google (Supabase lưu ở user_metadata). null nếu không có. */
  protected avatarUrl(user: { user_metadata?: Record<string, unknown> } | null): string | null {
    const m = user?.user_metadata ?? {};
    return ((m['avatar_url'] as string) || (m['picture'] as string) || null) || null;
  }
  /** Chữ cái đầu (tên hoặc email) để hiện khi không có ảnh. */
  protected userInitial(user: { email?: string; user_metadata?: Record<string, unknown> } | null): string {
    const name = ((user?.user_metadata?.['full_name'] as string) || user?.email || '?').trim();
    return name.charAt(0).toUpperCase() || '?';
  }
  /** Nhãn hiển thị cạnh avatar: CHỈ biệt danh (full_name). Chưa đặt -> rỗng (KHÔNG lộ email). */
  protected displayLabel(user: { email?: string; user_metadata?: Record<string, unknown> } | null): string {
    return ((user?.user_metadata?.['full_name'] as string) || '').trim();
  }

  async logout(): Promise<void> {
    // Đăng xuất -> ra thẳng trang landing (không phải trang đăng nhập).
    await this.supabase.signOutToLanding();
  }
}
