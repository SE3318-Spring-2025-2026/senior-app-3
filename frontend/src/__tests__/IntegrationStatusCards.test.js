import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import GitHubStatusCard from '../components/GitHubStatusCard';
import JiraStatusCard from '../components/JiraStatusCard';

describe('Integration Status Cards', () => {
  const mockGitHubDataConnected = {
    connected: true,
    repo_url: 'https://github.com/team/repo',
    last_synced: '2025-04-08T10:00:00Z'
  };

  const mockGitHubDataDisconnected = {
    connected: false,
    repo_url: null,
    last_synced: null
  };

  const mockJiraDataConnected = {
    connected: true,
    project_key: 'ALPHA',
    board_url: 'https://jira.example.com/browse/ALPHA'
  };

  const mockJiraDataDisconnected = {
    connected: false,
    project_key: null,
    board_url: null
  };

  describe('GitHubStatusCard', () => {
    it('renders connected state with repo URL', () => {
      render(<GitHubStatusCard data={mockGitHubDataConnected} isLoading={false} />);

      expect(screen.getByText('GitHub Integration')).toBeInTheDocument();
      expect(screen.getByText('Connected')).toBeInTheDocument();
      expect(screen.getByText(/Repository URL:/i)).toBeInTheDocument();
    });

    it('displays repo URL as clickable link when connected', () => {
      render(<GitHubStatusCard data={mockGitHubDataConnected} isLoading={false} />);

      const link = screen.getByRole('link', { name: /github.com.team.repo/i });
      expect(link).toHaveAttribute('href', 'https://github.com/team/repo');
      expect(link).toHaveAttribute('target', '_blank');
    });

    it('displays last synced timestamp when connected', () => {
      render(<GitHubStatusCard data={mockGitHubDataConnected} isLoading={false} />);

      expect(screen.getByText(/Last Synced:/i)).toBeInTheDocument();
      // Check that the date is formatted
      const dateText = screen.getByText(/\//).textContent;
      expect(dateText).toBeTruthy();
    });

    it('renders disconnected state with setup prompt', () => {
      render(<GitHubStatusCard data={mockGitHubDataDisconnected} isLoading={false} />);

      expect(screen.getByText('Disconnected')).toBeInTheDocument();
      expect(screen.getByText(/GitHub integration not configured/i)).toBeInTheDocument();
      expect(screen.getByText(/Set up your GitHub organization/i)).toBeInTheDocument();
    });

    it('handles null data gracefully', () => {
      render(<GitHubStatusCard data={null} isLoading={false} />);

      expect(screen.getByText('GitHub Integration')).toBeInTheDocument();
    });

    it('shows not synced when last_synced is null', () => {
      const data = { connected: true, repo_url: 'https://github.com/test/repo', last_synced: null };
      render(<GitHubStatusCard data={data} isLoading={false} />);

      expect(screen.getByText('Not synced')).toBeInTheDocument();
    });
  });

  describe('JiraStatusCard', () => {
    it('renders connected state with project key', () => {
      render(<JiraStatusCard data={mockJiraDataConnected} isLoading={false} />);

      expect(screen.getByText('JIRA Integration')).toBeInTheDocument();
      expect(screen.getByText('Connected')).toBeInTheDocument();
      expect(screen.getByText(/Project Key:/i)).toBeInTheDocument();
      expect(screen.getByText('ALPHA')).toBeInTheDocument();
    });

    it('displays board URL as clickable link when connected', () => {
      render(<JiraStatusCard data={mockJiraDataConnected} isLoading={false} />);

      const link = screen.getByRole('link', { name: /jira.example.com.browse.ALPHA/i });
      expect(link).toHaveAttribute('href', 'https://jira.example.com/browse/ALPHA');
      expect(link).toHaveAttribute('target', '_blank');
    });

    it('renders disconnected state with setup prompt', () => {
      render(<JiraStatusCard data={mockJiraDataDisconnected} isLoading={false} />);

      expect(screen.getByText('Disconnected')).toBeInTheDocument();
      expect(screen.getByText(/JIRA integration not configured/i)).toBeInTheDocument();
      expect(screen.getByText(/Set up your JIRA project/i)).toBeInTheDocument();
    });

    it('handles null data gracefully', () => {
      render(<JiraStatusCard data={null} isLoading={false} />);

      expect(screen.getByText('JIRA Integration')).toBeInTheDocument();
    });

    it('shows not available when board_url is null', () => {
      const data = { connected: true, project_key: 'BETA', board_url: null };
      render(<JiraStatusCard data={data} isLoading={false} />);

      expect(screen.getByText('Not available')).toBeInTheDocument();
    });

    it('displays not configured when project_key is null', () => {
      const data = { connected: true, project_key: null, board_url: 'https://jira.example.com' };
      render(<JiraStatusCard data={data} isLoading={false} />);

      expect(screen.getByText('Not configured')).toBeInTheDocument();
    });
  });

  describe('Status Badge Styling', () => {
    it('applies connected class to status badge when connected', () => {
      const { container } = render(
        <GitHubStatusCard data={mockGitHubDataConnected} isLoading={false} />
      );

      const badge = container.querySelector('.status-badge.connected');
      expect(badge).toBeInTheDocument();
    });

    it('applies disconnected class to status badge when disconnected', () => {
      const { container } = render(
        <GitHubStatusCard data={mockGitHubDataDisconnected} isLoading={false} />
      );

      const badge = container.querySelector('.status-badge.disconnected');
      expect(badge).toBeInTheDocument();
    });

    it('displays connected status dot', () => {
      const { container } = render(
        <GitHubStatusCard data={mockGitHubDataConnected} isLoading={false} />
      );

      const statusDot = container.querySelector('.status-dot.connected');
      expect(statusDot).toBeInTheDocument();
    });

    it('displays disconnected status dot', () => {
      const { container } = render(
        <GitHubStatusCard data={mockGitHubDataDisconnected} isLoading={false} />
      );

      const statusDot = container.querySelector('.status-dot.disconnected');
      expect(statusDot).toBeInTheDocument();
    });
  });
});
