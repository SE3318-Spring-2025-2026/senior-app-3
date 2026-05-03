import '@testing-library/jest-dom';
import useOnboardingStore from '../store/onboardingStore';

describe('OnboardingStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useOnboardingStore.getState().reset();
  });

  afterEach(() => {
    useOnboardingStore.getState().reset();
  });

  describe('password never persisted to localStorage', () => {
    it('does not write password to localStorage when setPassword is called', (done) => {
      useOnboardingStore.getState().setPassword('s3cr3tP@ss');

      setTimeout(() => {
        const raw = localStorage.getItem('onboarding-storage');
        expect(raw).not.toBeNull();
        const { state } = JSON.parse(raw);
        expect(state).not.toHaveProperty('password');
        done();
      }, 10);
    });

    it('does not leak the password value into the localStorage string', (done) => {
      useOnboardingStore.getState().setPassword('should-not-appear-in-storage');

      setTimeout(() => {
        const raw = localStorage.getItem('onboarding-storage');
        expect(raw).not.toContain('should-not-appear-in-storage');
        done();
      }, 10);
    });

    it('persists non-sensitive fields (email, validationToken, userId) correctly', (done) => {
      useOnboardingStore.getState().setEmail('student@example.com');
      useOnboardingStore.getState().setValidationToken('tok_abc123');
      useOnboardingStore.getState().setUserId('usr_001');

      setTimeout(() => {
        const { state } = JSON.parse(localStorage.getItem('onboarding-storage'));
        expect(state.email).toBe('student@example.com');
        expect(state.validationToken).toBe('tok_abc123');
        expect(state.userId).toBe('usr_001');
        done();
      }, 10);
    });

    it('does not persist password even when set alongside other fields', (done) => {
      useOnboardingStore.getState().setEmail('user@example.com');
      useOnboardingStore.getState().setPassword('alongside-secret');

      setTimeout(() => {
        const { state } = JSON.parse(localStorage.getItem('onboarding-storage'));
        expect(state.email).toBe('user@example.com');
        expect(state).not.toHaveProperty('password');
        done();
      }, 10);
    });
  });

  describe('in-memory password state', () => {
    it('stores and clears password in memory without touching localStorage', () => {
      useOnboardingStore.getState().setPassword('in-memory-only');
      expect(useOnboardingStore.getState().password).toBe('in-memory-only');

      useOnboardingStore.getState().setPassword(null);
      expect(useOnboardingStore.getState().password).toBeNull();
    });

    it('reset() clears password from in-memory state', () => {
      useOnboardingStore.getState().setPassword('clear-on-reset');
      useOnboardingStore.getState().reset();
      expect(useOnboardingStore.getState().password).toBeNull();
    });
  });
});
