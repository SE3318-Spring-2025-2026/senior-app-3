import React from 'react';
import './PageTitle.css';

/**
 * Reusable PageTitle component for consistent page headers across the application
 * 
 * @param {string} title - Main title text
 * @param {string} [subtitle] - Optional subtitle/description text
 * @param {string} [kicker] - Optional small label above title
 * @param {React.ReactNode} [actions] - Optional action buttons or elements
 * @param {string} [className] - Optional additional CSS classes
 */
const PageTitle = ({ title, subtitle, kicker, actions, className = '' }) => {
  return (
    <header className={`page-title ${className}`}>
      <div className="page-title-content">
        {kicker && <p className="page-title-kicker">{kicker}</p>}
        <h1 className="page-title-heading">{title}</h1>
        {subtitle && <p className="page-title-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-title-actions">{actions}</div>}
    </header>
  );
};

export default PageTitle;
