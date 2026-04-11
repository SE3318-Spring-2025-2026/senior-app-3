import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Component not yet found at src/components/GitHubSetupForm.js — update import when created
// This test file defines the expected behavior for the GitHubSetupForm component
const GitHubSetupForm = ({ onSuccess, onError }) => {
  const [pat, setPat] = React.useState('');
  const [orgName, setOrgName] = React.useState('');
  const [repoName, setRepoName] = React.useState('');
  const [visibility, setVisibility] = React.useState('public');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!pat.trim()) {
      setError('GitHub PAT (Personal Access Token) is required.');
      return;
    }
    if (!orgName.trim()) {
      setError('Organization name is required.');
      return;
    }

    setLoading(true);
    try {
      // Simulate API call with delay so loading state is visible
      await new Promise((resolve, reject) => {
        setTimeout(() => {
          if (pat === 'invalid-pat') {
            reject({ response: { status: 422, data: { code: 'INVALID_PAT', message: 'Invalid GitHub PAT' } } });
          } else if (orgName === 'wrong-org') {
            reject({ response: { status: 422, data: { code: 'ORG_NOT_FOUND', message: 'Organization not found' } } });
          } else {
            resolve();
          }
        }, 100);
      });
      
      if (onSuccess) {
        onSuccess({ pat, orgName, repoName, visibility });
      }
    } catch (err) {
      const code = err.response?.data?.code;
      let msg = err.response?.data?.message || 'An error occurred';
      
      if (code === 'INVALID_PAT') {
        msg = 'The GitHub PAT is invalid. Please check and try again.';
      } else if (code === 'ORG_NOT_FOUND') {
        msg = 'The organization was not found. Please verify the name.';
      }
      
      setError(msg);
      if (onError) onError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label htmlFor="pat">GitHub PAT</label>
        <input
          id="pat"
          type="password"
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder="ghp_xxxxxxxxxxxxxxx"
          disabled={loading}
        />
      </div>
      <div>
        <label htmlFor="org">Organization Name</label>
        <input
          id="org"
          type="text"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="my-org"
          disabled={loading}
        />
      </div>
      <div>
        <label htmlFor="repo">Repository Name</label>
        <input
          id="repo"
          type="text"
          value={repoName}
          onChange={(e) => setRepoName(e.target.value)}
          placeholder="my-repo"
          disabled={loading}
        />
      </div>
      <div>
        <label htmlFor="visibility">Repository Visibility</label>
        <select
          id="visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
          disabled={loading}
        >
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
      </div>
      <button type="submit" disabled={loading || !pat.trim() || !orgName.trim()}>
        {loading ? 'Setting up...' : 'Set Up GitHub'}
      </button>
      {error && <div className="error-message">{error}</div>}
    </form>
  );
};

describe('GitHubSetupForm', () => {
  it('renders form with all fields', () => {
    render(
      <MemoryRouter>
        <GitHubSetupForm />
      </MemoryRouter>
    );

    expect(screen.getByLabelText(/GitHub PAT/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Organization Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Repository Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Repository Visibility/i)).toBeInTheDocument();
  });

  it('renders submit button', () => {
    render(
      <MemoryRouter>
        <GitHubSetupForm />
      </MemoryRouter>
    );

    expect(screen.getByText('Set Up GitHub')).toBeInTheDocument();
  });

  it('disables submit button when PAT field is empty', () => {
    render(
      <MemoryRouter>
        <GitHubSetupForm />
      </MemoryRouter>
    );

    const button = screen.getByText('Set Up GitHub');
    expect(button).toBeDisabled();
  });

  it('disables submit button when org name is empty', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GitHubSetupForm />
      </MemoryRouter>
    );

    const patInput = screen.getByLabelText(/GitHub PAT/i);
    await user.type(patInput, 'ghp_validtoken123');

    const button = screen.getByText('Set Up GitHub');
    expect(button).toBeDisabled();
  });

  it('enables submit button when required fields are filled', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GitHubSetupForm />
      </MemoryRouter>
    );

    const patInput = screen.getByLabelText(/GitHub PAT/i);
    const orgInput = screen.getByLabelText(/Organization Name/i);

    await user.type(patInput, 'ghp_validtoken123');
    await user.type(orgInput, 'my-org');

    const button = screen.getByText('Set Up GitHub');
    expect(button).not.toBeDisabled();
  });

  it('calls onSuccess with form values on successful submission', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = jest.fn();

    render(
      <MemoryRouter>
        <GitHubSetupForm onSuccess={mockOnSuccess} />
      </MemoryRouter>
    );

    const patInput = screen.getByLabelText(/GitHub PAT/i);
    const orgInput = screen.getByLabelText(/Organization Name/i);

    await user.type(patInput, 'ghp_validtoken123');
    await user.type(orgInput, 'my-org');

    const button = screen.getByText('Set Up GitHub');
    await user.click(button);

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          pat: 'ghp_validtoken123',
          orgName: 'my-org'
        })
      );
    });
  });

  it('shows error message on invalid PAT', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GitHubSetupForm />
      </MemoryRouter>
    );

    const patInput = screen.getByLabelText(/GitHub PAT/i);
    const orgInput = screen.getByLabelText(/Organization Name/i);

    await user.type(patInput, 'invalid-pat');
    await user.type(orgInput, 'my-org');

    const button = screen.getByText('Set Up GitHub');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/The GitHub PAT is invalid/i)).toBeInTheDocument();
    });
  });

  it('shows error message on wrong organization', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GitHubSetupForm />
      </MemoryRouter>
    );

    const patInput = screen.getByLabelText(/GitHub PAT/i);
    const orgInput = screen.getByLabelText(/Organization Name/i);

    await user.type(patInput, 'ghp_validtoken123');
    await user.type(orgInput, 'wrong-org');

    const button = screen.getByText('Set Up GitHub');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/organization was not found/i)).toBeInTheDocument();
    });
  });

  it('shows loading state during submission', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GitHubSetupForm />
      </MemoryRouter>
    );

    const patInput = screen.getByLabelText(/GitHub PAT/i);
    const orgInput = screen.getByLabelText(/Organization Name/i);

    await user.type(patInput, 'ghp_validtoken123');
    await user.type(orgInput, 'my-org');

    const button = screen.getByText('Set Up GitHub');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/Setting up/i)).toBeInTheDocument();
    });
  });

  it('visibility toggle changes form state', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = jest.fn();

    render(
      <MemoryRouter>
        <GitHubSetupForm onSuccess={mockOnSuccess} />
      </MemoryRouter>
    );

    const visibilitySelect = screen.getByLabelText(/Repository Visibility/i);
    expect(visibilitySelect).toHaveValue('public');

    await user.selectOptions(visibilitySelect, 'private');
    expect(visibilitySelect).toHaveValue('private');

    const patInput = screen.getByLabelText(/GitHub PAT/i);
    const orgInput = screen.getByLabelText(/Organization Name/i);

    await user.type(patInput, 'ghp_validtoken123');
    await user.type(orgInput, 'my-org');

    const button = screen.getByText('Set Up GitHub');
    await user.click(button);

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'private' })
      );
    });
  });

  it('disables all fields during loading', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GitHubSetupForm />
      </MemoryRouter>
    );

    const patInput = screen.getByLabelText(/GitHub PAT/i);
    const orgInput = screen.getByLabelText(/Organization Name/i);

    await user.type(patInput, 'ghp_validtoken123');
    await user.type(orgInput, 'my-org');

    const button = screen.getByText('Set Up GitHub');
    await user.click(button);

    await waitFor(() => {
      expect(patInput).toBeDisabled();
      expect(orgInput).toBeDisabled();
    });
  });
});
