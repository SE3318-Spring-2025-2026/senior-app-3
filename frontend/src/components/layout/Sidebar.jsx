import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import useAuthStore from '../../store/authStore';
import { normalizeGroupId } from '../../utils/groupId';

const isLikelyConcreteGroupId = (value) => {
  const normalized = normalizeGroupId(value);
  if (!normalized) return false;
  // Reserved route fragments like /groups/new must not be treated as real group ids.
  if (normalized.toLowerCase() === 'new') return false;
  return true;
};

const Sidebar = ({ isCollapsed, onToggle }) => {
  const { user, isAuthenticated, clearAuth } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    clearAuth();
    navigate('/auth/method-selection');
  };

  const hasRole = (roles) => {
    if (!user?.role) return false;
    return roles.includes(user.role);
  };

  const getRoleLabel = () => {
    if (!user?.role) return 'User';
    return user.role.charAt(0).toUpperCase() + user.role.slice(1).replace(/_/g, ' ');
  };

  const reviewGroupId = [
    user?.groupId,
    user?.advisedGroupId,
    user?.advisorGroupId,
    user?.currentGroupId,
  ].map((value) => normalizeGroupId(value)).find(Boolean);
  const routeGroupIdMatch = location.pathname.match(/^\/groups\/([^/]+)/);
  const routeGroupId = routeGroupIdMatch?.[1];
  const routeDerivedGroupId = isLikelyConcreteGroupId(routeGroupId) ? routeGroupId : null;
  const userGroupId = [
    user?.groupId,
    user?.advisedGroupId,
    user?.advisorGroupId,
    user?.currentGroupId,
    routeDerivedGroupId,
  ].map((value) => normalizeGroupId(value)).find(Boolean) || null;

  const navSections = [
    {
      title: 'Main',
      items: [
        {
          label: 'Dashboard', path: '/dashboard', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          )
        },
        {
          label: 'Profile', path: '/profile', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          )
        },
      ],
    },
    {
      title: 'Academic Center',
      requiredRoles: ['professor', 'advisor', 'admin', 'committee_member', 'coordinator'],
      items: [
        {
          label: 'Inbox', path: '/professor/inbox', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          ), requiredRoles: ['professor']
        },
        {
          label: 'Grade Review',
          path: reviewGroupId
            ? `/groups/${reviewGroupId}/final-grades/review`
            : '/professor/grade-review',
          icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-6m4 6V7m4 10v-4M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          ),
          requiredRoles: ['professor', 'advisor'],
        },
        {
          label: 'Jury Committees', path: '/jury/committees', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ), requiredRoles: ['professor', 'committee_member', 'admin']
        },
        {
          label: 'Setup Account', path: '/professor/setup', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          ), requiredRoles: ['professor', 'admin', 'committee_member']
        },
      ],
    },
    {
      title: 'Groups',
      items: [
        {
          label: 'Create Group', path: '/groups/new', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ), requiredRoles: ['student']
        },
        {
          label: 'Group Dashboard', path: userGroupId ? `/groups/${userGroupId}` : '/dashboard', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          ),
          requiredRoles: ['student', 'advisor'],
          disabled: !userGroupId
        },
        {
          label: 'Advisor Request', path: userGroupId ? `/groups/${userGroupId}/advisor-request` : '/dashboard', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          ), requiredRoles: ['student'], disabled: !userGroupId
        },
        {
          label: 'Advisor Panel', path: userGroupId ? `/groups/${userGroupId}/advisor` : '/dashboard', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          ), requiredRoles: ['student'], disabled: !userGroupId
        },
        {
          label: 'Submit Deliverable', path: '/dashboard/submit-deliverable', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          ), requiredRoles: ['student']
        },
        {
          label: 'Final Grades', path: '/me/final-grades', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
            </svg>
          ), requiredRoles: ['student']
        },
        {
          label: 'Group Coordinator', path: userGroupId ? `/groups/${userGroupId}/coordinator` : '/coordinator', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          ), requiredRoles: ['coordinator', 'admin'], disabled: !userGroupId && !hasRole(['coordinator', 'admin'])
        },
      ],
    },
    {
      title: 'Administration',
      requiredRoles: ['coordinator', 'admin'],
      items: [
        {
          label: 'Coordinator Panel', path: '/coordinator', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          )
        },
        {
          label: 'Sprint Dashboard', path: '/coordinator/sprint-dashboard', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-6m3 6V7m3 10v-4m5 6H4a1 1 0 01-1-1V4a1 1 0 011-1h16a1 1 0 011 1v14a1 1 0 01-1 1z" />
            </svg>
          ), requiredRoles: ['coordinator']
        },
        {
          label: 'New Committee', path: '/coordinator/committees/new', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          ), requiredRoles: ['coordinator']
        },
        {
          label: 'Advisor requests', path: '/coordinator/advisor-requests', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          ), requiredRoles: ['coordinator', 'admin']
        },
        {
          label: 'Manage Professors', path: '/admin/professor-creation', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ), requiredRoles: ['admin']
        },
        {
          label: 'Password Reset', path: '/admin/password-reset', icon: (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          ), requiredRoles: ['admin']
        },
      ],
    },
  ];

  if (!isAuthenticated) return null;

  const visibleSections = navSections
    .filter(section => !section.requiredRoles || hasRole(section.requiredRoles))
    .map(section => ({
      ...section,
      items: section.items.filter(item => !item.requiredRoles || hasRole(item.requiredRoles))
    }))
    .filter(section => section.items.length > 0);

  return (
    <div
      className={`fixed left-0 top-0 h-screen bg-[#0f172a] text-slate-300 transition-all duration-300 ease-in-out z-50 flex flex-col ${isCollapsed ? 'w-20' : 'w-[260px]'
        }`}
    >
      {/* Header */}
      <div className="h-20 flex items-center justify-between px-6 border-b border-slate-800/50">
        {!isCollapsed && (
          <div className="flex items-center space-x-3">
            <div className="h-8 w-8 bg-indigo-500 rounded-lg flex items-center justify-center text-white font-bold shadow-lg shadow-indigo-500/20">S</div>
            <span className="text-xl font-serif italic text-white tracking-tight">SeniorApp</span>
          </div>
        )}
        {isCollapsed && (
          <div className="mx-auto h-8 w-8 bg-indigo-500 rounded-lg flex items-center justify-center text-white font-bold">S</div>
        )}
        <button
          onClick={onToggle}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-white transition-colors"
        >
          <svg className={`h-5 w-5 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* User Info */}
      <div className={`px-4 py-6 border-b border-slate-800/50 bg-slate-900/30`}>
        <div className={`flex items-center space-x-4 ${isCollapsed ? 'justify-center' : ''}`}>
          {!isCollapsed && (
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-white truncate">{user?.email || 'Academic User'}</p>
              <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest truncate">{getRoleLabel()}</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-8 scrollbar-hide">
        {visibleSections.map((section, idx) => (
          <div key={idx} className="space-y-2">
            {!isCollapsed && (
              <h3 className="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4">
                {section.title}
              </h3>
            )}
            <div className="space-y-1">
              {section.items.map((item, i) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={i}
                    to={item.path}
                    className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-all group ${isActive
                      ? 'bg-indigo-600/10 text-indigo-400 border-l-4 border-indigo-500 rounded-l-none'
                      : 'hover:bg-slate-800/50 hover:text-white'
                      } ${isCollapsed ? 'justify-center' : ''} ${item.disabled ? 'opacity-50 pointer-events-none' : ''}`}
                    title={isCollapsed ? item.label : ''}
                  >
                    <div className={`flex-shrink-0 transition-colors ${isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'}`}>
                      {item.icon}
                    </div>
                    {!isCollapsed && (
                      <span className={`text-sm font-medium truncate ${isActive ? 'text-white font-bold' : ''}`}>
                        {item.label}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-slate-800/50">
        <button
          onClick={handleLogout}
          className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all text-slate-400 hover:text-white hover:bg-red-500/10 group ${isCollapsed ? 'justify-center' : ''}`}
        >
          <div className="group-hover:text-red-400">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </div>
          {!isCollapsed && <span className="text-sm font-medium">LOGOUT</span>}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
