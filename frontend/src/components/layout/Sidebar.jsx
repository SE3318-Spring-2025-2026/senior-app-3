import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import useAuthStore from '../../store/authStore';

const Sidebar = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
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

  const navSections = [
    {
      title: 'Main',
      items: [
        { label: 'Dashboard', path: '/dashboard', icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        )},
        { label: 'Profile', path: '/profile', icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        )},
      ],
    },
    {
      title: 'Student Center',
      requiredRoles: ['student'],
      items: [
        { label: 'Submit Deliverable', path: '/dashboard/submit-deliverable', icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        )},
        { label: 'Create Group', path: '/groups/new', icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )},
      ],
    },
    {
      title: 'Academic Center',
      requiredRoles: ['professor', 'admin', 'committee_member'],
      items: [
        { label: 'Setup Account', path: '/professor/setup', icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )},
        { label: 'Inbox', path: '/professor/inbox', icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        ), requiredRoles: ['professor'] },
        { label: 'Jury Committees', path: '/jury/committees', icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )},
      ],
    },
    {
      title: 'Administrator',
      requiredRoles: ['coordinator', 'admin'],
      items: [
        { label: 'Coordinator Panel', path: '/coordinator', icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        )},
        { label: 'Manage Professors', path: '/admin/professor-creation', icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ), requiredRoles: ['admin'] },
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
      className={`fixed left-0 top-0 h-screen bg-[#0f172a] text-slate-300 transition-all duration-300 ease-in-out z-50 flex flex-col ${
        isCollapsed ? 'w-20' : 'w-[260px]'
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
          onClick={() => setIsCollapsed(!isCollapsed)}
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
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold shadow-lg flex-shrink-0">
            {user?.name?.charAt(0) || 'U'}
          </div>
          {!isCollapsed && (
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-white truncate">{user?.name || 'Academic User'}</p>
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
                    className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-all group ${
                      isActive 
                        ? 'bg-indigo-600/10 text-indigo-400 border-l-4 border-indigo-500 rounded-l-none' 
                        : 'hover:bg-slate-800/50 hover:text-white'
                    } ${isCollapsed ? 'justify-center' : ''}`}
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
          {!isCollapsed && <span className="text-sm font-medium">System Exit</span>}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
