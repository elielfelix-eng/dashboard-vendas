import { Sidebar } from '@/components/sidebar';
import { requireUser } from '@/lib/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireUser();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar role={profile?.role} name={profile?.full_name ?? user.email ?? ''} />
      <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
