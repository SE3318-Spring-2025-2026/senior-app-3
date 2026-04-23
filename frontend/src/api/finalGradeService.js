import apiClient from './apiClient';

const asArray = (value) => (Array.isArray(value) ? value : []);

const getFinalGradesFromResponse = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.finalGrades)) return data.finalGrades;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.grades)) return data.grades;
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
  return [];
};

/**
 * Fetch committee-scoped published final grade results.
 *
 * Issue #257 / Process 8.5:
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

const finalGradeService = {
  getCommitteeFinalResults,
};

export default finalGradeService;
