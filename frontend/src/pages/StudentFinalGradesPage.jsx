import React, { useEffect, useMemo, useState } from 'react';
import { getMyFinalGrades } from '../api/finalGradeService';
import useAuthStore from '../store/authStore';
import './StudentFinalGradesPage.css';

const formatNumber = (value, fractionDigits = 2) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Not available';
  return number.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
};

const formatDateTime = (value) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const resolveErrorMessage = (error) => {
  const status = error?.response?.status;
  const code = error?.code;

  if (status === 403 || code === 'FORBIDDEN') {
    return {
      title: 'Access denied',
      message: 'You are not authorized to view final grades.',
    };
  }

  if (status === 404) {
    return {
      title: 'Final grades are not published yet',
      message: 'Your final grades will appear here after the coordinator publishes them.',
      empty: true,
    };
  }

  return {
    title: 'Unable to load final grades',
    message: error?.response?.data?.message || error?.message || 'Please refresh and try again.',
  };
};

const getPublishedAt = (grade) => grade.updatedAt || grade.createdAt;

const getCurrentStudentId = (user) => user?.studentId || user?.id || user?._id;

const isCurrentStudentGrade = (grade, currentStudentId) => {
  if (!currentStudentId) return true;
  const gradeStudentId = grade?.studentId || grade?.student?.id || grade?.student?._id;
  return !gradeStudentId || String(gradeStudentId) === String(currentStudentId);
};

const StudentFinalGradesPage = () => {
  const { user } = useAuthStore();
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadFinalGrades = async ({ isRefresh = false } = {}) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    setError(null);
    try {
      const data = await getMyFinalGrades();
      setGrades(data);
    } catch (err) {
      setGrades([]);
      setError(resolveErrorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadFinalGrades();
  }, []);

  const currentStudentId = getCurrentStudentId(user);
  const publishedGrades = useMemo(
    () =>
      grades.filter(
        (grade) => grade?.status === 'published' && isCurrentStudentGrade(grade, currentStudentId)
      ),
    [grades, currentStudentId]
  );

  const latestGrade = publishedGrades[0];
  const hasPublishedGrades = publishedGrades.length > 0;

  return (
    <div className="student-final-grades-page">
      <header className="student-final-grades-header">
        <div>
          <p className="student-final-grades-kicker">Student final grade</p>
          <h1>Final Grades</h1>
          <p className="student-final-grades-meta">
            Published D7 records for your own student account.
          </p>
        </div>
        <button
          type="button"
          className="student-final-grades-button"
          onClick={() => loadFinalGrades({ isRefresh: true })}
          disabled={loading || refreshing}
        >
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </header>

      {loading && (
        <div className="student-final-grades-state" role="status">
          Loading final grades
        </div>
      )}

      {!loading && error && !error.empty && (
        <div className="student-final-grades-error" role="alert">
          <h2>{error.title}</h2>
          <p>{error.message}</p>
        </div>
      )}

      {!loading && (!hasPublishedGrades || error?.empty) && (
        <div className="student-final-grades-empty">
          <h2>Final grades are not published yet</h2>
          <p>Your final grades will appear here after the coordinator publishes them.</p>
        </div>
      )}

      {!loading && hasPublishedGrades && (
        <>
          <section className="student-final-grades-summary" aria-label="Published final grade summary">
            <div className="student-final-grades-score">
              <span>Final grade</span>
              <strong>{formatNumber(latestGrade.finalGrade)}</strong>
            </div>
            <div className="student-final-grades-facts">
              <div>
                <span>Group</span>
                <strong>{latestGrade.groupId || 'Not available'}</strong>
              </div>
              <div>
                <span>Published</span>
                <strong>{formatDateTime(getPublishedAt(latestGrade))}</strong>
              </div>
              {latestGrade.baseGroupScore != null && (
                <div>
                  <span>Base group score</span>
                  <strong>{formatNumber(latestGrade.baseGroupScore)}</strong>
                </div>
              )}
              {latestGrade.individualRatio != null && (
                <div>
                  <span>Contribution ratio</span>
                  <strong>{formatNumber(latestGrade.individualRatio, 4)}</strong>
                </div>
              )}
            </div>
          </section>

          <section className="student-final-grades-panel">
            <div className="student-final-grades-panel-header">
              <h2>Published grade history</h2>
              <p>Only published records returned for your student account are shown.</p>
            </div>
            <div className="student-final-grades-table-wrap">
              <table className="student-final-grades-table">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Final grade</th>
                    <th>Base score</th>
                    <th>Ratio</th>
                    <th>Published</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {publishedGrades.map((grade, index) => (
                    <tr key={`${grade.groupId || 'group'}-${grade.studentId || 'student'}-${index}`}>
                      <td>{grade.groupId || 'Not available'}</td>
                      <td>{formatNumber(grade.finalGrade)}</td>
                      <td>{grade.baseGroupScore == null ? 'Not available' : formatNumber(grade.baseGroupScore)}</td>
                      <td>{grade.individualRatio == null ? 'Not available' : formatNumber(grade.individualRatio, 4)}</td>
                      <td>{formatDateTime(getPublishedAt(grade))}</td>
                      <td>
                        <span className="student-final-grades-status">Published</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default StudentFinalGradesPage;

