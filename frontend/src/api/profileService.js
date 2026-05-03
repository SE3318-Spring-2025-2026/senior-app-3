import { updateAccount } from './authService';

export const updateProfile = (userId, updates) => updateAccount(userId, updates);
