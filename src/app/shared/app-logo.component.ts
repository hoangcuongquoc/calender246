// Logo Foresight — DÙNG CHUNG với header, landing page và favicon (public/favicon.svg).
// Sửa logo thì sửa favicon.svg rồi chép lại đoạn <path> này cho khớp.
// Tách thành component riêng (trước đây lặp lại y hệt ở header) để nơi nào cần logo
// (vd màn hình loading) chỉ cần <app-logo class="h-7 w-7" /> thay vì dán lại cả khối SVG.

import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="209.20 79.40 186.70 159.70" aria-hidden="true">
      <defs><linearGradient id="foresightLogoGrad" x1="209.20" y1="239.10" x2="395.90" y2="79.40" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3E68AC"/><stop offset=".5" stop-color="#4E78BC"/><stop offset="1" stop-color="#5E86C4"/></linearGradient></defs><g transform="translate(0,327) scale(0.1,-0.1)" fill="url(#foresightLogoGrad)" stroke="none"><path d="M3203 2421 c-141 -38 -224 -94 -373 -247 -64 -66 -192 -198 -286 -294 -93 -96 -224 -231 -291 -300 l-121 -125 2 -60 1 -60 333 0 332 0 0 -207 0 -208 80 0 80 0 2 208 3 207 45 0 45 0 0 70 0 70 -47 -2 -48 -3 -2 288 -3 287 -77 -82 -78 -82 0 -203 0 -203 -230 0 c-127 -1 -230 1 -230 4 0 3 46 52 103 110 56 59 206 213 332 344 300 311 375 362 561 374 133 9 259 -40 391 -153 84 -72 84 -77 21 -141 -198 -202 -417 -247 -673 -138 -18 8 -19 7 -6 -9 66 -81 303 -135 454 -103 l37 8 0 -346 c0 -332 -1 -346 -20 -365 -19 -19 -33 -20 -270 -20 l-250 0 0 -37 c0 -21 -3 -48 -6 -61 l-7 -23 286 3 c414 4 381 -38 385 499 l3 399 37 19 c59 31 152 111 201 174 55 71 54 75 -79 207 -156 155 -270 210 -455 216 -87 3 -125 0 -182 -15z"/><path d="M2539 2334 c-7 -9 -13 -35 -14 -57 l-1 -42 -81 -5 c-148 -9 -163 -39 -163 -332 l0 -212 60 59 60 59 0 73 0 73 66 0 66 0 133 138 132 137 -78 3 -79 3 0 44 c0 67 -63 104 -101 59z"/><path d="M3282 2213 c-147 -72 -88 -298 78 -298 109 0 182 95 156 201 l-7 28 -22 -27 c-33 -39 -78 -40 -103 -2 -21 32 -11 72 21 87 13 6 22 15 19 19 -9 15 -107 9 -142 -8z"/><path d="M3314 1667 c-3 -8 -4 -39 -2 -68 l3 -54 67 -3 c77 -3 82 3 76 89 l-3 44 -68 3 c-51 2 -69 -1 -73 -11z m106 -35 c0 -20 -46 -52 -58 -40 -16 16 -15 29 1 22 8 -3 20 2 27 11 13 16 30 20 30 7z"/><path d="M3112 1613 l3 -58 55 0 55 0 3 58 3 57 -61 0 -61 0 3 -57z"/><path d="M2563 1636 c-46 -39 -9 -107 50 -92 52 13 59 83 11 105 -32 14 -28 15 -61 -13z"/><path d="M3110 1405 l0 -55 60 0 60 0 0 55 0 55 -60 0 -60 0 0 -55z"/><path d="M3328 1418 c-7 -63 -3 -68 58 -68 l54 0 0 55 0 55 -54 0 -54 0 -4 -42z"/><path d="M2282 1151 c3 -141 10 -159 72 -205 25 -19 44 -21 212 -24 l184 -3 0 60 0 61 -153 0 c-198 0 -191 -5 -192 132 l0 103 -63 3 -64 3 4 -130z"/><path d="M2575 1248 c-58 -33 -39 -108 28 -108 57 0 74 84 22 108 -30 14 -25 14 -50 0z"/><path d="M3114 1247 c-3 -8 -4 -34 -2 -58 l3 -44 58 -3 58 -3 -3 58 -3 58 -53 3 c-38 2 -54 -1 -58 -11z"/><path d="M3350 1242 c-43 -35 -23 -102 31 -102 56 0 82 73 37 104 -29 20 -41 20 -68 -2z"/></g>
    </svg>
  `,
})
export class AppLogoComponent {}
