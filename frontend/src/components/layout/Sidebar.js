import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/authStore';
import './Sidebar.css';

/**
 * Sidebar Navigation Component
 * Displays current user info and navigation links
 * Collapsible for smaller screens
 */
const Sidebar = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { user, isAuthenticated, clearAuth } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    clearAuth();
    navigate('/auth/method-selection');
  };

  // Navigation items based on user role
  const getNavItems = () => {
    const items = [
      { label: 'Dashboard', path: '/dashboard', icon: '📊' },
    ];

    if (user?.role === 'student') {
      items.push(
        { label: 'Create Group', path: '/groups/new', icon: '➕' }
      );
    }

    if (user?.role === 'professor' || user?.role === 'admin') {
      items.push(
        { label: 'Professor Setup', path: '/professor/setup', icon: '⚙️' }
      );
    }

    if (user?.role === 'professor' || user?.role === 'committee_member' || user?.role === 'admin') {
      items.push(
        { label: 'Jury Committees', path: '/jury/committees', icon: '🎓' }
      );
    }

    if (user?.role === 'admin') {
      items.push(
        { label: 'Admin - Password Reset', path: '/admin/password-reset', icon: '🔑' },
        { label: 'Admin - Create Professor', path: '/admin/professor-creation', icon: '👨‍🎓' }
      );
    }

    if (user?.role === 'coordinator') {
      items.push(
        { label: 'Coordinator Panel', path: '/coordinator', icon: '🎛️' }
      );
    }

    items.push(
      { label: 'Profile', path: '/profile', icon: '👤' }
    );

    return items;
  };

  if (!isAuthenticated) {
    return null;
  }

  const navItems = getNavItems();

  return (
    <div className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      {/* Header with toggle icon */}
      <div className="sidebar-header">
        <button
          className="sidebar-toggle"
          onClick={() => setIsCollapsed(!isCollapsed)}
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? '→' : '←'}
        </button>
        {!isCollapsed && <h2 className="sidebar-title">NavApp</h2>}
      </div>

      {/* User Info Section */}
      <div className="sidebar-user-section">
        <div className="user-avatar">
          {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
        </div>
        {!isCollapsed && (
          <div className="user-info">
            <div className="user-name">{user?.name || 'User'}</div>
            <div className="user-role">{user?.role || 'Unknown'}</div>
            {user?.email && <div className="user-email">{user.email}</div>}
          </div>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className="nav-link"
            title={isCollapsed ? item.label : ''}
          >
            <span className="nav-icon">{item.icon}</span>
            {!isCollapsed && <span className="nav-label">{item.label}</span>}
          </Link>
        ))}
      </nav>

      {/* Logout Button */}
      <div className="sidebar-footer">
        <button
          onClick={handleLogout}
          className="logout-button"
          title={isCollapsed ? 'Logout' : ''}
        >
          <span className="nav-icon">🚪</span>
          {!isCollapsed && <span>Logout</span>}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
