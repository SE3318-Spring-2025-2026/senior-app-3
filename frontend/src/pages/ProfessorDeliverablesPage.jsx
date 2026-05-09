import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listAllDeliverables } from '../api/reviewAPI';

const DELIVERABLE_TYPE_LABELS = {
  proposal: 'Proposal',
  statement_of_work: 'Statement of Work',
  demo: 'Demo',
  interim_report: 'Interim Report',
  final_report: 'Final Report',
};

const STATUS_COLORS = {
  submitted: 'bg-blue-100 text-blue-800',
  under_review: 'bg-yellow-100 text-yellow-800',
  accepted: 'bg-green-100 text-green-800',
  awaiting_resubmission: 'bg-orange-100 text-orange-800',
  retracted: 'bg-gray-100 text-gray-600',
};

const ALL_STATUSES = ['submitted', 'under_review', 'accepted', 'awaiting_resubmission', 'retracted'];

const ProfessorDeliverablesPage = () => {
  const navigate = useNavigate();

  const [deliverables, setDeliverables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const LIMIT = 20;

  const fetchDeliverables = useCallback(async (currentPage, currentStatus) => {
    try {
      setLoading(true);
      setError('');
      const data = await listAllDeliverables({
        page: currentPage,
        limit: LIMIT,
        ...(currentStatus && { status: currentStatus }),
      });
      setDeliverables(data.deliverables || []);
      setTotal(data.total || 0);
      setTotalPages(Math.max(1, Math.ceil((data.total || 0) / LIMIT)));
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load deliverables');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDeliverables(page, statusFilter);
  }, [page, statusFilter, fetchDeliverables]);

  const handleStatusChange = (e) => {
    setStatusFilter(e.target.value);
    setPage(1);
  };

  const formatDate = (date) =>
    new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="page p-8">
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '700', color: '#111827', marginBottom: '6px' }}>
            Submitted Deliverables
          </h1>
          <p style={{ color: '#6b7280', fontSize: '14px' }}>
            View and review all deliverables submitted by student groups.
          </p>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', alignItems: 'center' }}>
          <select
            value={statusFilter}
            onChange={handleStatusChange}
            style={{
              padding: '8px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px',
              color: '#374151',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            <option value="">All statuses</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>

          {total > 0 && (
            <span style={{ fontSize: '13px', color: '#9ca3af' }}>
              {total} deliverable{total !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
            <p style={{ color: '#991b1b', fontSize: '14px' }}>{error}</p>
          </div>
        )}

        {/* Table */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center' }}>
              <div style={{ display: 'inline-block', width: '40px', height: '40px', border: '3px solid #e5e7eb', borderTopColor: '#4f46e5', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <p style={{ marginTop: '12px', color: '#6b7280', fontSize: '14px' }}>Loading deliverables...</p>
            </div>
          ) : deliverables.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center' }}>
              <p style={{ color: '#9ca3af', fontSize: '14px' }}>No deliverables found.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  {['Type', 'Group', 'Sprint', 'Version', 'Status', 'Submitted At', ''].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '12px 16px',
                        textAlign: 'left',
                        fontSize: '11px',
                        fontWeight: '600',
                        color: '#6b7280',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deliverables.map((d, idx) => (
                  <tr
                    key={d.deliverableId}
                    style={{
                      borderBottom: idx < deliverables.length - 1 ? '1px solid #f3f4f6' : 'none',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <td style={{ padding: '14px 16px', fontSize: '14px', color: '#111827', fontWeight: '500' }}>
                      {DELIVERABLE_TYPE_LABELS[d.deliverableType] || d.deliverableType}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '13px', color: '#6b7280', fontFamily: 'monospace' }}>
                      {d.groupId || '—'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '13px', color: '#6b7280' }}>
                      {d.sprintId || '—'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '13px', color: '#6b7280' }}>
                      v{d.version ?? 1}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span
                        style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: '500' }}
                        className={STATUS_COLORS[d.status] || 'bg-gray-100 text-gray-600'}
                      >
                        {d.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '13px', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                      {formatDate(d.submittedAt)}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <button
                        onClick={() => navigate(`/dashboard/reviews/${d.deliverableId}`)}
                        style={{
                          padding: '6px 14px',
                          background: '#4f46e5',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: '500',
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#4338ca')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = '#4f46e5')}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '20px' }}>
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 1 || loading}
              style={{
                padding: '7px 14px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#374151',
                background: '#fff',
                cursor: page === 1 ? 'not-allowed' : 'pointer',
                opacity: page === 1 ? 0.5 : 1,
              }}
            >
              ← Previous
            </button>
            <span style={{ fontSize: '13px', color: '#6b7280' }}>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page === totalPages || loading}
              style={{
                padding: '7px 14px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#374151',
                background: '#fff',
                cursor: page === totalPages ? 'not-allowed' : 'pointer',
                opacity: page === totalPages ? 0.5 : 1,
              }}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default ProfessorDeliverablesPage;
