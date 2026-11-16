import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./lib/config.mjs";

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const fileItems = [
  {"bucket_id":"attendance-photos","name":"df857653-8c98-47e5-8646-66a1a49b6e08/1791750276386.webp"},
  {"bucket_id":"attendance-photos","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1792309766341.webp"},
  {"bucket_id":"attendance-photos","name":"df857653-8c98-47e5-8646-66a1a49b6e08/1791750326494.webp"},
  {"bucket_id":"attendance-photos","name":"df857653-8c98-47e5-8646-66a1a49b6e08/1791750341388.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/probe-1792384967422.png"},
  {"bucket_id":"attendance-photos","name":"df857653-8c98-47e5-8646-66a1a49b6e08/1791750491589.webp"},
  {"bucket_id":"attendance-photos","name":"ecd0bd9a-919a-4986-818e-afe1eba9039a/1791784235358.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/probe-1792385291202.png"},
  {"bucket_id":"attendance-photos","name":"5426f157-2382-450d-ab73-7618aa5d33a7/1791818039043.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792833697643.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792833709124.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792833776917.webp"},
  {"bucket_id":"inspection-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/2478bbcc-6081-4133-af62-4c7066b94f64/ZYZQ4H46-process-1792836390175.webp"},
  {"bucket_id":"inspection-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/2478bbcc-6081-4133-af62-4c7066b94f64/ZYZQ4H46-after-1792836522260.webp"},
  {"bucket_id":"attendance-photos","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1792338678148.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792696119366.webp"},
  {"bucket_id":"attendance-photos","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1794049838946.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1791880563871.webp"},
  {"bucket_id":"attendance-photos","name":"ff8278f1-08d0-4efc-bf43-a43000aca86c/1794049912900.webp"},
  {"bucket_id":"attendance-photos","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1792003584366.webp"},
  {"bucket_id":"cash-proofs","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1792003890648.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792948422607.webp"},
  {"bucket_id":"attendance-photos","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1792071157943.webp"},
  {"bucket_id":"cash-proofs","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1792340278317.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792071722662.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792696125023.webp"},
  {"bucket_id":"attendance-photos","name":"ff8278f1-08d0-4efc-bf43-a43000aca86c/1794248401504.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/probe-1792385071486.png"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792833799458.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792988328404.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792825331382.webp"},
  {"bucket_id":"attendance-photos","name":"ff8278f1-08d0-4efc-bf43-a43000aca86c/1794359710162.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792825335436.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792340978143.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792341666285.webp"},
  {"bucket_id":"inspection-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/2478bbcc-6081-4133-af62-4c7066b94f64/ZYZQ4H46-before-1792836326453.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/probe-1792385144501.png"},
  {"bucket_id":"inspection-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/2478bbcc-6081-4133-af62-4c7066b94f64/ZYZQ4H46-process-1792836369627.webp"},
  {"bucket_id":"attendance-photos","name":"559a9428-a871-4e15-a9b5-61d5dded6ad2/1793132070132.webp"},
  {"bucket_id":"attendance-photos","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1792381373972.webp"},
  {"bucket_id":"attendance-photos","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1792826885766.webp"},
  {"bucket_id":"attendance-photos","name":"559a9428-a871-4e15-a9b5-61d5dded6ad2/1793132073460.webp"},
  {"bucket_id":"attendance-photos","name":"1c5a2dae-fcea-4d50-af30-2902e81e921b/1794642667257.webp"},
  {"bucket_id":"attendance-photos","name":"1c5a2dae-fcea-4d50-af30-2902e81e921b/1794642681880.webp"},
  {"bucket_id":"attendance-photos","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1792225533661.webp"},
  {"bucket_id":"attendance-photos","name":"5c6a3577-e403-4332-aac4-0921bdb61a2d/1793159680877.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792381876074.webp"},
  {"bucket_id":"attendance-photos","name":"5c6a3577-e403-4332-aac4-0921bdb61a2d/1793159823414.webp"},
  {"bucket_id":"attendance-photos","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1792826937339.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/probe-1792385221321.png"},
  {"bucket_id":"attendance-photos","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1792827141828.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/probe-1792385248091.png"},
  {"bucket_id":"cash-proofs","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/probe-1792385248463.png"},
  {"bucket_id":"inspection-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/2478bbcc-6081-4133-af62-4c7066b94f64/ZYZQ4H46-before-1792836343327.webp"},
  {"bucket_id":"timeoff-proofs","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/probe-1792385248646.png"},
  {"bucket_id":"cash-proofs","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/probe-1792385291898.png"},
  {"bucket_id":"timeoff-proofs","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/probe-1792385292039.png"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/probe-1792385324502.png"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792831956347.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792831960404.webp"},
  {"bucket_id":"attendance-photos","name":"ff8278f1-08d0-4efc-bf43-a43000aca86c/1794033548956.webp"},
  {"bucket_id":"attendance-photos","name":"ff8278f1-08d0-4efc-bf43-a43000aca86c/1794033906451.webp"},
  {"bucket_id":"attendance-photos","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1794726321455.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792832180696.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/probe-1792385396218.png"},
  {"bucket_id":"cash-proofs","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/probe-1792385397280.png"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792832215603.webp"},
  {"bucket_id":"timeoff-proofs","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/probe-1792385397589.png"},
  {"bucket_id":"attendance-photos","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1794043740632.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792832227034.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/probe-1792385421878.png"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792832236006.webp"},
  {"bucket_id":"attendance-photos","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1792406573124.webp"},
  {"bucket_id":"profile-avatars","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/avatar-1792684798929.webp"},
  {"bucket_id":"attendance-photos","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1794043747565.webp"},
  {"bucket_id":"attendance-photos","name":"d8e084f4-4e72-41b5-ae17-50c9df1fb8d5/1792832993221.webp"},
  {"bucket_id":"attendance-photos","name":"ee34ed6e-c704-4ee7-a3a0-e0572117cf1a/1794043797680.webp"}
];

async function main() {
  console.log(`Menghapus ${fileItems.length} file di storage...`);
  // Group by bucket
  const byBucket = {};
  for (const item of fileItems) {
    if (!byBucket[item.bucket_id]) byBucket[item.bucket_id] = [];
    byBucket[item.bucket_id].push(item.name);
  }

  for (const [bucket, names] of Object.entries(byBucket)) {
    console.log(`Menghapus ${names.length} file di bucket ${bucket}...`);
    const { data, error } = await supabase.storage.from(bucket).remove(names);
    if (error) {
      console.error(`Error deleting from ${bucket}:`, error.message);
    } else {
      console.log(`Sukses menghapus ${data.length} file di ${bucket}`);
    }
  }
}

main().catch(console.error);
