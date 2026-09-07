/* The app frame: fixed navy sidebar + scrolling main content. */

import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { FolderKanban, ListChecks, FileText, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import logo from '../assets/brand/biz2code-logo.png';

function initials(email: string) {
  const name = email.split('@')[0] ?? '';
  return name.slice(0, 2).toUpperCase();
}

function NavItem({
  to,
  icon,
  label,
  active,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 12px',
        borderRadius: 'var(--radius-control)',
        fontFamily: 'var(--font-ui)',
        fontSize: 13.5,
        fontWeight: active ? 600 : 500,
        background: active ? 'rgba(255,255,255,.09)' : 'transparent',
        color: active ? '#fff' : 'var(--text-inverse-muted)',
        transition: 'var(--transition-control)',
        textDecoration: 'none',
      }}
    >
      {icon}
      {label}
    </Link>
  );
}

interface Props {
  children: ReactNode;
}

export function AppShell({ children }: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const projectId = params.projectId;
  const phaseNo = params.phaseNo ?? '1';
  const { pathname } = useLocation();

  const onProjects = pathname === '/projects';
  const onPhase = pathname.includes('/phase/');
  const onDocuments = pathname.endsWith('/documents');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--surface-page)' }}>
      <aside
        style={{
          width: 288,
          flex: 'none',
          background: 'var(--navy-800)',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 14px',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div style={{ padding: '0 8px 22px' }}>
          {}
          <img
            src={logo}
            alt="biz2code"
            style={{ height: 78, width: 'auto', maxWidth: '100%', display: 'block' }}
          />
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <NavItem to="/projects" icon={<FolderKanban size={16} />} label="Projects" active={onProjects} />
          {projectId && (
            <>
              <NavItem
                to={`/projects/${projectId}/phase/${phaseNo}`}
                icon={<ListChecks size={16} />}
                label="Phases"
                active={onPhase}
              />
              <NavItem
                to={`/projects/${projectId}/documents`}
                icon={<FileText size={16} />}
                label="Documents"
                active={onDocuments}
              />
            </>
          )}
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {user && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: 12,
                borderRadius: 'var(--radius-card)',
                background: 'rgba(255,255,255,.06)',
              }}
            >
              <span
                style={{
                  width: 30,
                  height: 30,
                  flex: 'none',
                  borderRadius: '50%',
                  background: 'var(--cyan-500)',
                  color: 'var(--navy-900)',
                  display: 'grid',
                  placeItems: 'center',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 11.5,
                  fontWeight: 700,
                }}
              >
                {initials(user.email)}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 12.5,
                  color: 'var(--text-inverse-muted)',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={user.email}
              >
                {user.email}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => logout().then(() => navigate('/login'))}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 12px',
              border: 'none',
              background: 'transparent',
              borderRadius: 'var(--radius-control)',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-inverse-muted)',
              transition: 'var(--transition-control)',
            }}
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{children}</main>
    </div>
  );
}
