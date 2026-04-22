import apiClient from './apiClient';

const normalizeFinalGradeResponse = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.finalGrades)) return data.finalGrades;
  if (Array.isArray(data?.grades)) return data.grades;
  if (data) return [data];
  return [];
};

/**
 * Fetch published final grade records for the authenticated student.
 *
 * OpenAPI follow-up alignment:
 * GET /me/final-grades
 * Response shape is normalized to an array of D7 FinalGrade records.
 */
export const getMyFinalGrades = async () => {
  const response = await apiClient.get('/me/final-grades');
  return normalizeFinalGradeResponse(response.data);
};

