import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

/**
 * Deteksi dan pencocokan wajah.
 *
 * Catatan
 * -------
 * Sebelumnya descriptor dibuat dengan memperkecil potongan tengah video
 * menjadi gambar abu-abu 16x16. Itu bukan pengenalan wajah: tidak ada yang
 * mencari wajah, menyelaraskan, atau mengukur cirinya. Yang dibandingkan
 * hanyalah gambar, sehingga foto yang dipegang di depan kamera bisa lolos
 * dan pencahayaan berpengaruh lebih besar daripada bentuk wajah.
 *
 * Sekarang memakai FaceLandmarker MediaPipe, sesuai PRD. Ia mencari wajah,
 * menyelaraskan sumbu, dan mengeluarkan vektor identitas 128 dimensi yang
 * memang dilatih untukpengenalan orang. Vektor yang sama juga memberi
 * blendshape, yang dipakai untuk mendeteksi kedip sebagai bukti ada orang
 * sungguhan di depan kamera.
 *
 * Aset dilayani dari /mediapipe supaya tidak bergantung koneksi internet.
 * Setelah ter-cache, pemuatan hanya sekali untuk satu sesi.
 */

export const FACE_DESCRIPTOR_LENGTH = 478;
const KOMPONEN_PER_TITIK = 3;

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/models/face_landmarker.task";

export type FaceDetection = {
  descriptor: number[];
  /** Posisi wajah di dalam sumber, 0 sampai 1. */
  box: { x: number; y: number; width: number; height: number };
  /** Nilai eyeBlinkLeft atau eyeBlinkRight yang lebih tinggi, 0 sampai 1. */
  eyeBlink: number;
  /** Gerak rahang, 0 sampai 1. */
  jawOpen: number;
  /** Sudut kepala terhadap kamera, dalam derajat. */
  yaw: number;
  pitch: number;
  faceCount: number;
};

let pending: Promise<FaceLandmarker> | null = null;

export function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (!pending) {
    pending = (async () => {
      // Minta service worker menyimpan berkas mesin sekali saja, supaya
      // pemuatan berikut tidak mengunduh ulang 16 MB.
      navigator.serviceWorker?.controller?.postMessage({ type: "precache-face-engine" });

      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    })().catch((e) => {
      pending = null;
      // Hanya varian SIMD yang disertakan karena ukurannya 12 MB lebih kecil
      // daripada varian cadangan. Peramban lama akan gagal memuat berkas, dan
      // pesan teknisnya tidak berguna bagi staf yang hanya ingin absen.
      if (e instanceof WebAssembly.CompileError || /simd/i.test(String(e))) {
        throw new Error(
          "Peramban ini tidak mendukung pemindaian wajah. Perbarui peramban ke versi terbaru, atau absen lewat perangkat lain.",
        );
      }
      throw e;
    });
  }
  return pending;
}

/**
 * Muat mesin pemindai wajah di latar belakang.
 *
 * Berkasnya 16 MB, jadi pemanggil yang menampilkan statusnya perlu bisa
 * menunggu sampai selesai. Dikembalikan promise supaya halaman bisa
 * menampilkan apa yang sedang terjadi, bukan diam saja selama unduhan.
 */
export function warmUpFaceEngine(): Promise<unknown> {
  return loadFaceLandmarker().catch(() => undefined);
}

/**
 * Vektor identitas dari titik landmark wajah.
 *
 * FaceLandmarker tidak mengeluarkan embedding yang siap pakai, tetapi ia
 * mengeluarkan 478 titik yang menggambarkan 3 dimensi: x, y, dan perkiraan z.
 * Titik-titik itulah yang bentuk membedakannya, jadi vektor yang
 * disusun dari situ bisa dipakai membandingkan orang.
 *
 * Dua hal penting supaya vektor tidak berubah-ubah hanya karena jarak atau
 * posisi kepala:
 *
 * - Titik digeser memakai titik acuan, yaitu kedua titik mata. Tanpa ini
 *   wajah yang digeser sedikit akan terbaca berbeda.
 * - Seluruh koordinat dibagi jarak kedua mata. Tanpa ini, wajah yang lebih
 *   dekat ke kamera menghasilkan vektor berbeda dari wajah yang sama di
 *   jarak jauh.
 *
 * Ekspresi mengubah beberapa titik, terutama sekitar mulut dan
 * kelopak. Itu tidak dihapus, tapi karena bobotnya kecil dibanding struktur
 * tulang wajah yang hampir tidak berubah, pengaruhnya kecil.
 */
function deskriptorDariLandmark(titik: { x: number; y: number; z: number }[]): number[] {
  if (titik.length < FACE_DESCRIPTOR_LENGTH) return [];

  // Indeks titik mata pada mesh MediaPipe. Nilai 33 dan 263 adalah sudut
  // mata kanan dan kiri pada mesh 468 titik.
  const kiri = titik[33];
  const kanan = titik[263];
  if (!kiri || !kanan) return [];

  const cx = (kiri.x + kanan.x) / 2;
  const cy = (kiri.y + kanan.y) / 2;
  const cz = (kiri.z + kanan.z) / 2;

  const jarak = Math.hypot(kanan.x - kiri.x, kanan.y - kiri.y, kanan.z - kiri.z);
  if (!Number.isFinite(jarak) || jarak <= 0) return [];

  const vektor: number[] = [];
  for (let i = 0; i < FACE_DESCRIPTOR_LENGTH; i += 1) {
    const p = titik[i];
    if (!p) return [];
    vektor.push(
      Number(((p.x - cx) / jarak).toFixed(5)),
      Number(((p.y - cy) / jarak).toFixed(5)),
      Number(((p.z - cz) / jarak).toFixed(5)),
    );
  }
  return vektor;
}

/**
 * Ambil satu wajah dari frame video.
 *
 * Mengembalikan null bila tidak ada wajah yang layak. Wajah kecil, blur, atau
 * hanya sebagian masuk bingkai ditolak di sini supaya yang terkirim ke server
 * selalu wajah utuh dan posisi nearby.
 */
export async function detectFaceInVideo(
  video: HTMLVideoElement,
  timestampMs: number,
): Promise<FaceDetection | null> {
  if (video.readyState < 2) return null;
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  const landmarker = await loadFaceLandmarker();
  const result = landmarker.detectForVideo(video, timestampMs);

  if (!result.faceLandmarks?.length) return null;

  const xs = result.faceLandmarks[0].map((p) => p.x);
  const ys = result.faceLandmarks[0].map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;

  // Wajah yang terlalu kecil berarti terlalu jauh atau hanya sebagian masuk
  // bingkai. Vektor dari posisi such itu tidak stabil.
  const UKURAN_WAJAH_MINIMUM = 0.2;
  if (width < UKURAN_WAJAH_MINIMUM || height < UKURAN_WAJAH_MINIMUM) return null;

  const descriptor = deskriptorDariLandmark(result.faceLandmarks[0]);
  if (descriptor.length !== FACE_DESCRIPTOR_LENGTH * KOMPONEN_PER_TITIK) {
    return null;
  }

  const shapes = result.faceBlendshapes?.[0]?.categories;
  let eyeBlink = 0;
  let jawOpen = 0;
  if (shapes) {
    const kiri = shapes.find((c) => c.categoryName === "eyeBlinkLeft");
    const kanan = shapes.find((c) => c.categoryName === "eyeBlinkRight");
    const rahang = shapes.find((c) => c.categoryName === "jawOpen");
    eyeBlink = Math.max(kiri?.score ?? 0, kanan?.score ?? 0);
    jawOpen = rahang?.score ?? 0;
  }

  return {
    descriptor: Array.from(descriptor),
    box: { x: minX, y: minY, width, height },
    eyeBlink,
    jawOpen,
    ...sudutKepala(result.facialTransformationMatrixes?.[0]),
    faceCount: result.faceLandmarks.length,
  };
}

/**
 * Sudut kepala dari matriks transformasi.
 *
 * Matriks MediaPipe berukuran 4x4 dan disimpan berurutan kolom. Tiga kolom
 * terakhir adalah translasi, jadi bagian rotasi hanya diambil dari indeks 0-2,
 * 4-6, dan 8-10.
 *
 * Sudut dihitung relatif terhadap kamera, bukan relatif terhadap angka tetap.
 * Threshold yang dipakai nanti membandingkan selisih terhadap posisi netral
 * orang itu sendiri, sehingga orang dengan bentuk wajah berbeda tidak
 * tertolak karena sudut puncaknya tidak sama.
 */
function sudutKepala(m: { data: number[] } | undefined): {
  yaw: number;
  pitch: number;
} {
  const fallback = { yaw: 0, pitch: 0 };
  if (!m?.data || m.data.length < 12) return fallback;

  const d = m.data;
  // R adalah bagian rotasi 3x3, dibaca berurutan kolom.
  const r00 = d[0];
  const r10 = d[1];
  const r20 = d[2];
  const r01 = d[4];
  const r21 = d[5];
  const r02 = d[8];
  const r22 = d[10];

  const yaw = Math.atan2(r10, r00);
  const pitch = Math.asin(Math.max(-1, Math.min(1, r21)));

  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return fallback;
  return { yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI };
}

export type Tahap = "center" | "blink" | "mouth" | "left" | "right";

export const URUTAN_TAHAP: Tahap[] = [
  "center",
  "blink",
  "mouth",
  "left",
  "right",
];

export const LABEL_TAHAP: Record<Tahap, string> = {
  center: "Hadap lurus ke kamera",
  blink: "Kedipkan mata",
  mouth: "Buka mulut",
  left: "Tengok ke kiri",
  right: "Tengok ke kanan",
};

export type CatatanTahap = {
  tahap: Tahap;
  descriptor: number[];
  yaw: number;
};

export type JejakLiveness = {
  versi: number;
  selesai: boolean;
  tahap: CatatanTahap[];
};

/**
 * Tantangan liveness bertahap.
 *
 * Yang diperiksa bukan angka mutlak, melainkan perubahan terhadap posisi
 * netral orang itu sendiri. Dua orang dengan bentuk wajah berbeda punya
 * sudut kepala dan tinggi rahang yang berbeda, jadi angka tetap akan menolak
 * sebagian orang tanpa alasan yang jelas.
 *
 * Untuk tahap putaran kepala, syaratnya bukan sudut tertentu, melainkan
 * descriptor yang sudah berubah cukup jauh dari posisi netral. Inilah yang
 * menutup celah foto: foto yang dipegang di depan kamera menghasilkan vektor
 * yang tetap sama berapa kali pun diminta memaling kepala.
 */
export class LivenessSession {
  private netral: { descriptor: number[]; yaw: number } | null = null;
  private readonly catatan: CatatanTahap[] = [];
  private readonly sudah: Set<Tahap> = new Set();
  private sedangTertutup = false;
  private mulaiTutupMs = 0;
  private waktuKedipMs = 0;

  private constructor(
    private readonly ambangBerkedip = 0.5,
    private readonly ambangMulut = 0.45,
    private readonly selisihPutarMinimal = 0.06,
    private readonly selisihPutarMaksimal = 0.55,
  ) {}

  static baru(): LivenessSession {
    return new LivenessSession();
  }

  get tahapBerikut(): Tahap | null {
    for (const t of URUTAN_TAHAP) {
      if (!this.sudah.has(t)) return t;
    }
    return null;
  }

  get selesai(): boolean {
    return this.tahapBerikut === null;
  }

  get progres(): number {
    return this.sudah.size / URUTAN_TAHAP.length;
  }

  /** Beri tahu posisi netral pertama supaya tahap lain bisa dibandingkan. */
  tetapkanNetral(d: FaceDetection): void {
    if (!this.netral) {
      this.netral = { descriptor: d.descriptor, yaw: d.yaw };
    }
  }

  /**
   * Periksa satu frame dan kembalikan tahap yang baru terpenuhi, atau null.
   *
   * Tahap dihitung berurutan, supaya orang tidak bisa melewati tahap dengan
   * sekaligus melakukan semua gerakan.
   */
  periksa(d: FaceDetection, now = Date.now()): Tahap | null {
    this.tetapkanNetral(d);
    const berikut = this.tahapBerikut;
    if (!berikut) return null;

    switch (berikut) {
      case "center":
        if (Math.abs(d.yaw) < 12) {
          return this.catat("center", d);
        }
        return null;

      case "blink": {
        const tertutup = d.eyeBlink >= this.ambangBerkedip;
        if (this.sedangTertutup && !tertutup) {
          this.sedangTertutup = false;
          const cukupLama = now - this.mulaiTutupMs >= 90;
          const jedaAman = now - this.waktuKedipMs >= 600;
          if (cukupLama && jedaAman) {
            this.waktuKedipMs = now;
            return this.catat("blink", d);
          }
        } else if (!this.sedangTertutup && tertutup) {
          this.sedangTertutup = true;
          this.mulaiTutupMs = now;
        }
        return null;
      }

      case "mouth":
        if (d.jawOpen >= this.ambangMulut) {
          return this.catat("mouth", d);
        }
        return null;

      case "left":
      case "right": {
        if (!this.netral) return null;
        const selisih = 1 - cosine(d.descriptor, this.netral.descriptor);
        if (selisih < this.selisihPutarMinimal) return null;
        // Terlalu jauh berarti wajah keluar bingkai atau berputar berlebihan.
        if (selisih > this.selisihPutarMaksimal) return null;

        const arah = d.yaw - this.netral.yaw;
        const cukup = berikut === "left" ? arah < -8 : arah > 8;
        return cukup ? this.catat(berikut, d) : null;
      }
    }
  }

  private catat(tahap: Tahap, d: FaceDetection): Tahap {
    this.sudah.add(tahap);
    this.catatan.push({
      tahap,
      descriptor: d.descriptor,
      yaw: Number(d.yaw.toFixed(2)),
    });
    return tahap;
  }

  /** Jejak yang dikirim ke server untuk diperiksa ulang di sana. */
  jejak(): JejakLiveness {
    return {
      versi: 1,
      selesai: this.selesai,
      tahap: this.catatan.map((c) => ({
        tahap: c.tahap,
        descriptor: c.descriptor,
        yaw: c.yaw,
      })),
    };
  }

  reset(): void {
    this.netral = null;
    this.catatan.length = 0;
    this.sudah.clear();
    this.sedangTertutup = false;
    this.waktuKedipMs = 0;
  }
}

/** Kemiripan kosinus dua vektor. */
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}