/**
 * Perhitungan periode untuk rekap kehadiran.
 *
 * Semua nilai di sini adalah tanggal polos dalam format YYYY-MM-DD, tanpa
 * jam dan tanpa zona waktu, supaya tidak ada pergeseran tanggal ketika
 * perangkat berada di zona waktu berbeda. Zona waktu Asia/Jakarta hanya
 * relevan saat mengubah stempel waktu menjadi label, dan itu sudah ditangani
 * oleh lib/attendance.
 */

export type MonthKey = string; // YYYY-MM

export type DateRange = { from: string; to: string };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Jumlah hari dalam satu bulan, dihitung tanpa pustaka karena hanya ada 12 bulan. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthBounds(key: MonthKey): DateRange {
  const [year, month] = key.split("-").map(Number);
  return {
    from: toIso(year, month, 1),
    to: toIso(year, month, daysInMonth(year, month)),
  };
}

export function monthLabel(key: MonthKey): string {
  const [year, month] = key.split("-").map(Number);
  const nama = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ][month - 1];
  return `${nama} ${year}`;
}

/** Geser bulan sebesar delta. Melebihi batas tidak dibatasi. */
export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  const [year, month] = key.split("-").map(Number);
  const total = year * 12 + (month - 1) + delta;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/**
 * Tiga bulan terakhir yang bergulir, dihitung dari hari ini.
 *
 * Juli sampai Oktober untuk hari ini 15 Oktober: bukan Juli sampai
 * September. Yang dihitung adalah tiga bulan terakhir yang masih berjalan,
 * jadi dari awal bulan ketiga terdalam sampai hari ini.
 */
export function rollingMonths(todayIso: string, months = 3): DateRange {
  const [year, month] = todayIso.split("-").map(Number);
  const mulai = shiftMonth(`${year}-${pad(month)}`, -(months - 1));
  return { from: `${mulai}-01`, to: todayIso };
}

export type CalendarCell = {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
};

/**
 * Kisi kalender untuk satu bulan, selalu dimulai dari Senin.
 *
 * Hari dalam seminggu dihitung tanpa zona waktu: tanggal bulan ini
 * selalu jatuh di hari yang sama di UTC maupun WIB, jadi tidak perlu
 * konversi yang bisa menggeser satu hari ke tanggal yang salah.
 */
export function calendarCells(key: MonthKey, todayIso: string): CalendarCell[] {
  const [year, month] = key.split("-").map(Number);
  const pertama = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay memberi 0 untuk Minggu dan 6 untuk Sabtu. Senin harus jadi 0.
  const geser = (pertama.getUTCDay() + 6) % 7;

  const sel: CalendarCell[] = [];
  const mulai = new Date(Date.UTC(year, month - 1, 1 - geser));

  for (let i = 0; i < 42; i += 1) {
    const d = new Date(mulai.getTime() + i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    sel.push({
      date: iso,
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month - 1 && d.getUTCFullYear() === year,
      isToday: iso === todayIso,
    });
  }
  return sel;
}

export const HARI_MINGGUAN = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];