import apiClient from './apiClient';

/**
 * Helper to ensure a value is an array.
 */
const asArray = (value) => (Array.isArray(value) ? value : []);

/**
 * Normalizes different API response shapes into a flat array of grade objects.
 * Handles nested group data (Committees) and direct arrays/objects (Students).
 */
const getFinalGradesFromResponse = (data) => {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.finalGrades)) return data.finalGrades;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.grades)) return data.grades;
  
  // Handles committee response where grades are nested inside groups
  if (Array.isArray(data?.groups)) {
    return data.groups.flatMap((group) =>
      asArray(group.finalGrades || group.results || group.grades).map((grade) => ({
        ...grade,
        groupId: grade.groupId || group.groupId,
        groupName: grade.groupName || group.groupName,
        publishedAt: grade.publishedAt || group.publishedAt || data.publishedAt,
      }))
    );
  }

  // If it's a single object, wrap it in an array
  return typeof data === 'object' ? [data] : [];
};

/**
 * Fetch committee-scoped published final grade results.
 * GET /committees/{committeeId}/final-results?status=published
 */
export const getCommitteeFinalResults = async (committeeId) => {
  const response = await apiClient.get(`/committees/${committeeId}/final-results`, {
    params: { status: 'published' },
  });
  
  const data = response.data || {};
  const finalGrades = getFinalGradesFromResponse(data).filter(
    (grade) => !grade.status || grade.status === 'published'
  );

  return {
    ...data,
    committeeId: data.committeeId || committeeId,
    publishedAt: data.publishedAt || finalGrades[0]?.publishedAt || finalGrades[0]?.createdAt || null,
    finalGrades,
  };
};

/**
 * Fetch published final grade records for the authenticated student.
 * GET /me/final-grades
 */
export const getMyFinalGrades = async () => {
  const response = await apiClient.get('/me/final-grades');
  return getFinalGradesFromResponse(response.data);
};

const finalGradeService = {
  getCommitteeFinalResults,
  getMyFinalGrades,
};

export default finalGradeService;