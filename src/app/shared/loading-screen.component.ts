// Màn hình loading toàn trang — hiện khi vừa mở app và ĐANG chờ các lệnh tải khởi động
// (sự kiện, lời mời, lịch chia sẻ, nhóm, cài đặt — xem AppStartupService) xong hết.
// Thanh tiến trình ăn theo % THẬT (startup.progress()), không phải animation chạy giả.
// Dùng lại đúng token màu/theme của app (--app-bg, --accent-*, .dark) nên tự đổi màu theo
// accent color người dùng chọn và theo sáng/tối, không hard-code màu riêng.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslateService } from '../i18n/translate.service';
import { AppLogoComponent } from './app-logo.component';
import { AppStartupService } from './app-startup.service';

@Component({
  selector: 'app-loading-screen',
  standalone: true,
  imports: [AppLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8 bg-gray-50">
      <div class="flex flex-col items-center gap-3">
        <app-logo class="app-logo-breathe h-16 w-16 drop-shadow-sm" />
        <p class="text-lg font-semibold tracking-tight text-gray-800">{{ tr.t('nav.calendar') }}</p>
      </div>
      <div class="flex w-52 flex-col items-center gap-3">
        <div class="h-1 w-full overflow-hidden rounded-full bg-gray-200">
          <!-- Width ăn theo % THẬT các lệnh tải khởi động đã xong; transition mượt mỗi khi tăng. -->
          <div class="h-full rounded-full bg-blue-600 transition-[width] duration-300 ease-out" [style.width.%]="startup.progress() * 100"></div>
        </div>
        <p class="text-sm text-gray-400">{{ tr.t('loading.message') }}</p>
      </div>
    </div>
  `,
  styles: `
    /* Logo "thở" nhẹ thay vì animate-pulse mặc định (nhấp nháy mờ/rõ trông như bị lỗi render) */
    @keyframes app-logo-breathe {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.08); }
    }
    .app-logo-breathe { animation: app-logo-breathe 2.4s ease-in-out infinite; }
  `,
})
export class LoadingScreenComponent {
  protected readonly tr = inject(TranslateService);
  protected readonly startup = inject(AppStartupService);
}
