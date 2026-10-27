import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { ShiftConsole } from "@/components/shift/shift-console";
import { ATTENDANCE_ROLE_LABELS, wibNow } from "@/lib/attendance";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { Icon } from "@/components/ui/icon";


function cashBreakdown(rows: { type: string; amount: number; payment_method: string | null }[]) {
  let cashInCash = 0;
  let cashInOther = 0;
  let unknownIn = 0;
  let cashOut = 0;
  for (const row of rows) {
    const amount = Number(row.amount ?? 0);
    if (row.type === "out") {
      cashOut += amount;
    } else if (row.payment_method === "cash") {
      cashInCash += amount;
    } else if (row.payment_method === null) {
      unknownIn += amount;
    } else {
      cashInOther += amount;
    }
  }
  return { cashInCash, cashInOther, unknownIn, cashOut, transactions: rows.length };
}

export default async function ShiftPage() {
  // Gerbang keras: karyawan di-redirect ke beranda sebelum data kas ditarik.
  const session = await requirePermission("cash.shift_manage");

  const supabase = await createClient();
  // null berarti sedang viewing seluruh cabang lewat branch switcher.
  const branchId = scopedBranchId(session);
  const role = session.role;

  if (!branchId) {
    const viewingAll = session.branchScope === "all";
    return (
      <div className="flex flex-col w-full min-h-screen pb-nav">
        <SubPageHeader
          title="Audit Shift & Kas"
          branchName={viewingAll ? "Seluruh Cabang" : "Cabang Utama"}
          backHref="/dashboard"
        />
        <main className="flex-1 flex items-center justify-center px-gutter">
          <div className="w-full max-w-[420px] bg-surface rounded-3xl p-6 clay-card text-center flex flex-col items-center gap-3">
            <Icon name={viewingAll ? "domain_disabled" : "account_tree"} className="text-[40px] text-warning-base" />
            <h1 className="font-headline-1 text-headline-1 text-text-primary">
              {viewingAll ? "Pilih Satu Cabang" : "Cabang Belum Ditugaskan"}
            </h1>
            <p className="font-caption text-caption text-text-secondary leading-relaxed">
              {viewingAll
                ? "Shift dan kas hanya tercatat per cabang. Pilih satu cabang pada switcher di bagian atas untuk membuka atau menutup shift."
                : "Akun Anda belum terikat pada cabang. Hubungi Owner atau Maintainer."}
            </p>
            <a
              href="/dashboard"
              className="h-11 px-5 rounded-xl primary-gradient text-white font-body-bold text-body-bold flex items-center gap-2"
            >
              <Icon name="home" className="text-[18px]" />
              Kembali ke Beranda
            </a>
          </div>
        </main>
        <BottomNav role={session.role} />
      </div>
    );
  }

  const today = wibNow().dateIso;

  const [branchRes, handoffRes, cashRes] = await Promise.all([
    supabase
      .from("branches")
      .select("branch_name, operating_open_time, operating_close_time")
      .eq("id", branchId)
      .maybeSingle(),
    supabase
      .from("shift_handoffs")
      .select(
        "id, shift_date, opening_cash, expected_cash, actual_cash, difference, unknown_method_cash, status, notes, opened_at, closed_at, opened_by, closed_by",
      )
      .eq("branch_id", branchId)
      .eq("shift_date", today)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("cash_flow")
      .select("type, amount, payment_method")
      .eq("branch_id", branchId)
      .gte("created_at", `${today}T00:00:00+07:00`)
      .lte("created_at", `${today}T23:59:59.999+07:00`),
  ]);

  const branch = branchRes.data;
  const handoff = handoffRes.data;

  const userNames: Record<string, string> = {};
  const personIds: string[] = [];
  if (handoff?.opened_by) personIds.push(handoff.opened_by as string);
  if (handoff?.closed_by) personIds.push(handoff.closed_by as string);
  if (personIds.length) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", personIds);
    const typed = (people ?? []) as Array<{
      id?: string | null;
      full_name?: string | null;
    }>;
    for (const p of typed) {
      if (p.id) userNames[p.id] = p.full_name ?? "Staf";
    }
  }

  return (
    <div className="flex flex-col w-full min-h-screen pb-nav">
      <SubPageHeader
        title="Audit Shift & Kas"
        branchName={(branch?.branch_name as string) ?? "Cabang Utama"}
        backHref="/dashboard"
      />
      <ShiftConsole
        profile={{
          id: session.id,
          fullName: session.fullName,
          role,
          roleLabel: ATTENDANCE_ROLE_LABELS[role] ?? role,
        }}
        branch={{
          id: branchId,
          name: (branch?.branch_name as string) ?? "Cabang Utama",
          openTime: (branch?.operating_open_time as string) ?? "07:30:00",
          closeTime: (branch?.operating_close_time as string) ?? "21:00:00",
        }}
        today={today}
        handoff={
          handoff
            ? {
                id: handoff.id as string,
                status: handoff.status as "open" | "closed",
                openingCash: Number(handoff.opening_cash ?? 0),
                expectedCash:
                  handoff.expected_cash === null
                    ? null
                    : Number(handoff.expected_cash),
                actualCash:
                  handoff.actual_cash === null
                    ? null
                    : Number(handoff.actual_cash),
                difference:
                  handoff.difference === null
                    ? null
                    : Number(handoff.difference),
                unknownMethodCash: Number(handoff.unknown_method_cash ?? 0),
                notes: handoff.notes as string | null,
                openedAt: handoff.opened_at as string | null,
                closedAt: handoff.closed_at as string | null,
                openedBy: handoff.opened_by as string | null,
                closedBy: handoff.closed_by as string | null,
              }
            : null
        }
        cash={cashBreakdown((cashRes.data ?? []) as never[])}
        userNames={userNames}
      />
      <BottomNav role={session.role} />
    </div>
  );
}
