import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as groupService from '../api/groupService';
import JuryCommittees from '../components/JuryCommittees';

jest.mock('../api/groupService');

describe('JuryCommittees', () => {
  const committee = {
    committeeId: 'c1',
    committeeName: 'Gamma Committee',
    status: 'published',
    publishedAt: '2026-04-13T00:00:00Z',
    advisorIds: ['adv1'],
    juryIds: ['jury1'],
  };

  it('renders an empty state when no jury committees exist', async () => {
    groupService.getJuryCommittees.mockResolvedValue({ committees: [] });

    render(<JuryCommittees />);

    expect(screen.getByText(/Loading your assigned committees/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/You are not assigned to any jury committees yet/i)).toBeInTheDocument();
    });
  });

  it('renders published jury committee cards in read-only mode', async () => {
    groupService.getJuryCommittees.mockResolvedValue({ committees: [committee] });

    render(<JuryCommittees />);

    expect(await screen.findByText('Gamma Committee')).toBeInTheDocument();
    expect(screen.getByText('c1')).toBeInTheDocument();
    expect(screen.getByText(/adv1/i)).toBeInTheDocument();
    expect(screen.getByText(/jury1/i)).toBeInTheDocument();
  });
});
