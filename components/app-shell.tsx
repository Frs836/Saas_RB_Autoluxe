import { AppShellClient } from "@/components/app-shell-client";

interface AppShellProps {
  role: string;
  fullName: string;
  branchName: string;
  hasUnread: boolean;
  profileId: string;
  children: React.ReactNode;
}

export default function AppShell({
  role,
  fullName,
  branchName,
  hasUnread,
  profileId,
  children,
}: AppShellProps) {
  return (
    <AppShellClient
      role={role}
      fullName={fullName}
      branchName={branchName}
      hasUnread={hasUnread}
      profileId={profileId}
    >
      {children}
    </AppShellClient>
  );
}
