import create from 'zustand';
import { persist } from 'zustand/middleware';

export const STEPS = [
  { id: 1, label: 'Validate Student ID', key: 'studentIdValidated' },
  { id: 2, label: 'Create Account',      key: 'accountCreated' },
  { id: 3, label: 'Verify Email',        key: 'emailVerified' },
  { id: 4, label: 'Link GitHub',         key: 'githubLinked' },
];

const useOnboardingStore = create(
  persist(
    (set, get) => ({
      currentStep: 1,
      completed: {
        studentIdValidated: false,
        accountCreated: false,
        emailVerified: false,
        githubLinked: false,
      },
      // Data passed between steps
      validationToken: null,
      userId: null,
      email: null,
      password: null,
      emailLastSentAt: null,

      setStepComplete: (key) =>
        set((state) => ({ completed: { ...state.completed, [key]: true } })),

      setCurrentStep: (step) => set({ currentStep: step }),

      nextStep: () => {
        const { currentStep } = get();
        if (currentStep < STEPS.length) set({ currentStep: currentStep + 1 });
      },

      previousStep: () => {
        const { currentStep } = get();
        if (currentStep > 1) set({ currentStep: currentStep - 1 });
      },

      setValidationToken: (token) => set({ validationToken: token }),
      setUserId: (id) => set({ userId: id }),
      setEmail: (email) => set({ email }),
      setPassword: (password) => set({ password }),
      setEmailLastSentAt: (ts) => set({ emailLastSentAt: ts }),

      canNavigateTo: (stepId) => {
        const { completed } = get();
        if (stepId === 1) return true;
        if (stepId === 2) return completed.studentIdValidated;
        if (stepId === 3) return completed.accountCreated;
        if (stepId === 4) return completed.emailVerified;
        return false;
      },

      isFullyComplete: () => {
        const { completed } = get();
        return completed.studentIdValidated && completed.accountCreated && completed.emailVerified;
      },

      reset: () =>
        set({
          currentStep: 1,
          completed: {
            studentIdValidated: false,
            accountCreated: false,
            emailVerified: false,
            githubLinked: false,
          },
          validationToken: null,
          userId: null,
          email: null,
          password: null,
          emailLastSentAt: null,
        }),
    }),
    {
      name: 'onboarding-storage',
      storage: {
        getItem: (name) => {
          const item = localStorage.getItem(name);
          return item ? JSON.parse(item) : null;
        },
        setItem: (name, value) => localStorage.setItem(name, JSON.stringify(value)),
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);

export default useOnboardingStore;
