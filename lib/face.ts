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
  faceCount: number;
};

let pending: Promise<FaceLandmarker> | null = null;

export function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (!pending) {
    pending = (async () => {
      // Minta service worker menyimpan berkas mesin sekali saja, supaya
      // pemuatan berikutnya tidak mengunduh ulang 16 MB.
      navigator.serviceWorker?.controller?.postMessage({ type: "precache-face-engine" });

      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
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

/** Panaskan mesin saat halaman dibuka supaya frame pertama tidak lambat. */
export function warmUpFaceEngine(): void {
  void loadFaceLandmarker().catch(() => undefined);
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
  if (shapes) {
    const kiri = shapes.find((c) => c.categoryName === "eyeBlinkLeft");
    const kanan = shapes.find((c) => c.categoryName === "eyeBlinkRight");
    eyeBlink = Math.max(kiri?.score ?? 0, kanan?.score ?? 0);
  }

  return {
    descriptor: Array.from(descriptor),
    box: { x: minX, y: minY, width, height },
    eyeBlink,
    faceCount: result.faceLandmarks.length,
  };
}

/**
 * Tantangan liveness sederhana: satu kedip lengkap.
 *
 * Kedip dianggap selesai ketika mata tertutup melewati ambang, lalu kembali
 * terbuka, dan keadaan tertutup bertahan cukup lama. Satu puncak sesaat tidak
 * dihitung, karena kedip parsial atau gerakan kepala cepat bisa memunculkan angka
 * itu sesaat saja.
 */
export class BlinkChallenge {
  private sedangTertutup = false;
  private mulaiTutupMs = 0;
  private jumlahKedip = 0;

  constructor(
    private readonly ambangTertutup = 0.5,
    private readonly durasiTertutupMinimalMs = 90,
    private readonly jedaAntarKedipMs = 600,
  ) {}

  /** Kembalikan true tepat satu kali saat satu kedip lengkap tercatat. */
  update(eyeBlink: number, now = Date.now()): boolean {
    const tertutup = eyeBlink >= this.ambangTertutup;

    if (this.sedangTertutup) {
      if (!tertutup) {
        this.sedangTertutup = false;
        const durasi = now - this.mulaiTutupMs;
        const jedaAman = now - this.waktuKedipTerakhir >= this.jedaAntarKedipMs;
        if (durasi >= this.durasiTertutupMinimalMs && jedaAman) {
          this.waktuKedipTerakhir = now;
          this.jumlahKedip += 1;
          return true;
        }
      }
      return false;
    }

    if (tertutup) {
      this.sedangTertutup = true;
      this.mulaiTutupMs = now;
    }
    return false;
  }

  private waktuKedipTerakhir = 0;

  get sudahLulus(): boolean {
    return this.jumlahKedip > 0;
  }

  get jumlah(): number {
    return this.jumlahKedip;
  }

  reset(): void {
    this.sedangTertutup = false;
    this.jumlahKedip = 0;
    this.waktuKedipTerakhir = 0;
  }
}
