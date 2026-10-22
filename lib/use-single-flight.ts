"use client";

import { useCallback, useRef } from "react";

/**
 * Kunci sinkron untuk aksi yang membuat catatan baru di server.
 *
 * `useState` tidak cukup sebagai penjaga: dua klik yang datang sebelum React
 * sempat merender ulang sama-sama membaca nilai lama, sehingga keduanya lolos
 * dan terbentuk dua order atau dua catatan kas. Ref berubah seketika, jadi
 * panggilan kedua selalu ditolak.
 *
 * Pemakaian:
 *   if (!kunci.mulai()) return;
 *   try { ... } finally { kunci.selesai(); }
 */
export function useSingleFlight() {
  const aktif = useRef(false);

  const mulai = useCallback(() => {
    if (aktif.current) return false;
    aktif.current = true;
    return true;
  }, []);

  const selesai = useCallback(() => {
    aktif.current = false;
  }, []);

  return { mulai, selesai };
}
