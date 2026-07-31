import { DashboardSidebar } from "@/components/dashboard-sidebar";

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="dashboard-frame">
      <DashboardSidebar />
      <main className="dashboard-main">{children}</main>
    </div>
  );
}
