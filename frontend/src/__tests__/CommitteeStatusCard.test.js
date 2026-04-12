import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CommitteeStatusCard from '../components/CommitteeStatusCard';

describe('CommitteeStatusCard', () => {
  it('renders a placeholder before the committee is published', () => {
    render(
      <CommitteeStatusCard
        committeeStatus={{ committeeId: null, committee: null }}
        user={{ userId: 'usr_student' }}
      />
    );

    expect(screen.getByText(/Committee not yet published/i)).toBeInTheDocument();
    expect(screen.getByText(/When published, the committee name/i)).toBeInTheDocument();
  });

  it('renders published committee details with advisors and jury members', () => {
    render(
      <CommitteeStatusCard
        committeeStatus={{
          committeeId: 'c1',
          committee: {
            committeeName: 'Beta Committee',
            status: 'published',
            publishedAt: '2026-04-13T00:00:00Z',
            advisorIds: ['adv1'],
            juryIds: ['jury1'],
          },
        }}
        user={{ userId: 'adv1' }}
      />
    );

    expect(screen.getByText('Beta Committee')).toBeInTheDocument();
    expect(screen.getByText(/Published At/i)).toBeInTheDocument();
    expect(screen.getByText(/adv1/i)).toBeInTheDocument();
    expect(screen.getByText(/jury1/i)).toBeInTheDocument();
    expect(screen.getByText(/You are assigned to this committee as an advisor/i)).toBeInTheDocument();
  });
});
