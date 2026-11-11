/*
 * Helper sisi klien untuk mengunggah gambar ke Cloudinary memakai unsigned
 * upload preset. Hanya membutuhkan variabel NEXT_PUBLIC_ (cloud name dan
 * upload preset) sehingga aman dijalankan di browser tanpa API key/secret.
 *
 * Dipakai untuk foto inspeksi order. Hasilnya (URL absolut https) disimpan
 * langsung ke kolom photo_url, sehingga tidak ada lagi langkah menyusun URL
 * publik Supabase Storage seperti pada foto inspeksi lawas yang berupa path
 * relatif.
 */

export type CloudinaryUploadResult = {
  secureUrl: string;
  publicId: string;
};

/**
 * Mengunggah blob gambar ke Cloudinary melalui unsigned upload preset. Folder
 * ditetapkan "inspection-photos" supaya foto inspeksi terpisah dari aset
 * publik lain (mis. foto profil) di akun Cloudinary yang sama.
 *
 * Mengembalikan URL aman (https) dan public_id yang diberikan Cloudinary.
 */
export async function uploadImageToCloudinary(
  blob: Blob,
): Promise<CloudinaryUploadResult> {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  if (!cloudName) {
    throw new Error("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME belum dikonfigurasi.");
  }
  if (!uploadPreset) {
    throw new Error(
      "NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET belum dikonfigurasi.",
    );
  }

  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

  const form = new FormData();
  form.append("file", blob);
  form.append("upload_preset", uploadPreset);
  form.append("folder", "inspection-photos");

  const res = await fetch(endpoint, { method: "POST", body: form });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // abaikan kesalahan membaca isi respons
    }
    throw new Error(
      `Gagal mengunggah foto ke Cloudinary${detail ? `: ${detail}` : ""}.`,
    );
  }

  const data = (await res.json()) as {
    secure_url?: string;
    public_id?: string;
  };
  if (!data.secure_url || !data.public_id) {
    throw new Error("Cloudinary tidak mengembalikan URL atau public_id.");
  }
  return { secureUrl: data.secure_url, publicId: data.public_id };
}
