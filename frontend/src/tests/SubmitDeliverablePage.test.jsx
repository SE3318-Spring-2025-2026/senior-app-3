import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import SubmitDeliverablePage from '../pages/SubmitDeliverablePage';

// Mock the DeliverableSubmissionForm to keep test focused on page wiring
jest.mock('../components/deliverables/DeliverableSubmissionForm', () => () => (
  <div data-testid="deliverable-form">Mock Deliverable Form</div>
));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

test('renders deliverable submission form wrapper', () => {
  render(<SubmitDeliverablePage />);
  expect(screen.getByTestId('deliverable-form')).toBeInTheDocument();
});
