import React, { useEffect, useMemo, useState } from 'react';
import {
  getCoordinatorPendingAdvisorRequests,
  decideOnAdvisorRequest,
} from '../api/advisorService';

const formatDate = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch (_) {
    return iso;
  }
};

const ageInDays = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const ms = Date.now() - d.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
};

const personLabel = (name, email, id) =>
  name || email || (id ? id : '—');

const initialsFor = (name, email, id) => {
  const source = (name || email || id || '?').toString();
  const cleaned = source.replace(/[^A-Za-z0-9 ]/g, ' ').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

const Avatar = ({ name, email, id, tone = 'slate' }) => {
  const tones = {
    slate: 'bg-slate-200 text-slate-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    emerald: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span
      className={`inline-flex items-center justify-center w-9 h-9 rounded-full text-xs font-semibold shrink-0 ${tones[tone] || tones.slate}`}
    >
      {initialsFor(name, email, id)}
    </span>
  );
};

const PersonRow = ({ label, name, email, id, tone }) => (
  <div className="flex items-start gap-3">
    <Avatar name={name} email={email} id={id} tone={tone} />
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-medium text-slate-800 truncate">
        {personLabel(name, email, id)}
      </p>
      {(email && (name || email !== personLabel(name, email, id))) && (
        <p className="text-xs text-slate-500 truncate">{email}</p>
      )}
      {id && (
        <p className="font-mono text-[10px] text-slate-400 truncate">{id}</p>
      )}
    </div>
  </div>
);

const CoordinatorAdvisorInbox = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [processingId, setProcessingId] = useState(null);
  const [rejectReason, setRejectReason] = useState({});
  const [filter, setFilter] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getCoordinatorPendingAdvisorRequests();
      setRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.message;
      if (status === 403) {
        setError('You do not have permission to view advisor requests. Coordinator/admin role required.');
      } else {
        setError(msg || 'Failed to load advisor requests.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter((r) => {
      const haystack = [
        r.requestId,
        r.groupId,
        r.groupName,
        r.leaderId,
        r.leaderName,
        r.leaderEmail,
        r.professorId,
        r.professorName,
        r.professorEmail,
        r.message,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [filter, requests]);

  const describeDecisionError = (err, defaultMsg) => {
    const status = err.response?.status;
    const data = err.response?.data || {};
    if (status === 422 && data.code === 'OUTSIDE_SCHEDULE_WINDOW') {
      return 'Cannot decide right now: the advisor decision window is closed. Coordinators bypass this check, so this likely means a permission misconfiguration.';
    }
    if (status === 409 && data.code === 'GROUP_ALREADY_HAS_ADVISOR') {
      return 'Group already has another assigned advisor. Refresh and review.';
    }
    if (status === 409 && data.code === 'CONFLICT') {
      return data.message || 'Request was already processed by someone else. Refreshing the list.';
    }
    if (status === 404) {
      return 'Request no longer exists. It may have been cancelled.';
    }
    if (status === 403) {
      return 'Permission denied. You may not be the assigned professor; coordinator/admin role required to override.';
    }
    return data.message || defaultMsg;
  };

  const handleApprove = async (requestId) => {
    setProcessingId(requestId);
    setError(null);
    setInfo(null);
    try {
      const result = await decideOnAdvisorRequest(requestId, 'approve', null);
      setRequests((prev) => prev.filter((r) => r.requestId !== requestId));
      setInfo(`Approved ${requestId}. Group ${result.assignedGroupId || ''} is now bound to professor ${result.professorId || ''}.`);
    } catch (err) {
      setError(describeDecisionError(err, 'Approve failed.'));
      if ([404, 409].includes(err.response?.status)) {
        load();
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (requestId) => {
    const reason = (rejectReason[requestId] || '').trim();
    if (!reason) {
      setError('Reject reason is required (it is shown to the team in the rejection notice).');
      return;
    }
    setProcessingId(requestId);
    setError(null);
    setInfo(null);
    try {
      await decideOnAdvisorRequest(requestId, 'reject', reason);
      setRequests((prev) => prev.filter((r) => r.requestId !== requestId));
      setRejectReason((prev) => ({ ...prev, [requestId]: '' }));
      setInfo(`Rejected ${requestId} with reason recorded.`);
    } catch (err) {
      setError(describeDecisionError(err, 'Reject failed.'));
      if ([404, 409].includes(err.response?.status)) {
        load();
      }
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="page bg-slate-50 min-h-screen p-6">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                Advisor requests inbox
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                Review pending association requests from team leaders. Approving binds
                the group to the professor; rejecting requires a reason that is sent
                to the team. Coordinator decisions bypass the advisor schedule window.
              </p>
            </div>
            <button
              type="button"
              className="px-3 py-1.5 rounded-md border border-slate-300 text-sm bg-white hover:bg-slate-100 disabled:opacity-50"
              onClick={load}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            <div className="rounded-lg bg-white border border-slate-200 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Pending total
              </p>
              <p className="text-xl font-semibold text-slate-900">
                {loading ? '…' : requests.length}
              </p>
            </div>
            <div className="rounded-lg bg-white border border-slate-200 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Currently shown
              </p>
              <p className="text-xl font-semibold text-slate-900">
                {loading ? '…' : filtered.length}
              </p>
            </div>
            <div className="rounded-lg bg-white border border-slate-200 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Oldest pending
              </p>
              <p className="text-xl font-semibold text-slate-900">
                {(() => {
                  if (loading) return '…';
                  const oldest = requests.reduce((acc, r) => {
                    const days = ageInDays(r.createdAt);
                    if (days == null) return acc;
                    if (acc == null) return days;
                    return days > acc ? days : acc;
                  }, null);
                  if (oldest == null) return '—';
                  return `${oldest} day${oldest === 1 ? '' : 's'}`;
                })()}
              </p>
            </div>
          </div>
        </header>

        {requests.length > 0 && (
          <input
            type="text"
            className="w-full mb-4 border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Filter by group, professor, leader, request id, message…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}

        {error && (
          <div
            className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm"
            role="alert"
          >
            {error}
          </div>
        )}
        {info && (
          <div
            className="mb-4 p-3 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm"
            role="status"
          >
            {info}
          </div>
        )}

        {loading && <p className="text-slate-500">Loading…</p>}

        {!loading && requests.length === 0 && !error && (
          <div className="rounded-lg border border-slate-200 p-8 bg-white text-center">
            <p className="text-base font-medium text-slate-700 mb-1">
              No pending advisor requests
            </p>
            <p className="text-sm text-slate-500">
              Either no team has submitted a request, every request has been handled,
              or the association window has not opened yet so students cannot submit
              new ones. Coordinator → Schedule controls the windows.
            </p>
          </div>
        )}

        <ul className="space-y-4">
          {filtered.map((r) => {
            const days = ageInDays(r.createdAt);
            const isProcessing = processingId === r.requestId;
            return (
              <li
                key={r.requestId}
                className="border border-slate-200 rounded-lg bg-white shadow-sm overflow-hidden"
              >
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800">
                      Pending
                    </span>
                    <span className="font-mono text-xs text-slate-500 truncate">
                      {r.requestId}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 shrink-0">
                    {formatDate(r.createdAt)}
                    {days !== null && ` · ${days}d ago`}
                  </div>
                </div>

                <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                      Group
                    </p>
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {r.groupName || r.groupId}
                    </p>
                    <p className="font-mono text-[10px] text-slate-400 truncate">
                      {r.groupId}
                    </p>
                  </div>
                  <PersonRow
                    label="Team leader"
                    name={r.leaderName}
                    email={r.leaderEmail}
                    id={r.leaderId}
                    tone="indigo"
                  />
                  <PersonRow
                    label="Requested professor"
                    name={r.professorName}
                    email={r.professorEmail}
                    id={r.professorId}
                    tone="emerald"
                  />
                </div>

                {r.message && (
                  <div className="px-4 pb-2">
                    <div className="border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-sm italic text-slate-700">
                      “{r.message}”
                    </div>
                  </div>
                )}

                <div className="px-4 pb-4 pt-2 border-t border-slate-100 flex flex-col gap-2 sm:flex-row sm:items-start">
                  <textarea
                    className="flex-1 border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    rows={2}
                    placeholder="Reject reason (required to reject — sent to the team)"
                    value={rejectReason[r.requestId] || ''}
                    onChange={(e) =>
                      setRejectReason((prev) => ({
                        ...prev,
                        [r.requestId]: e.target.value,
                      }))
                    }
                  />
                  <div className="flex gap-2 sm:flex-col sm:w-40">
                    <button
                      type="button"
                      className="flex-1 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
                      disabled={isProcessing}
                      onClick={() => handleApprove(r.requestId)}
                    >
                      {isProcessing ? 'Working…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="flex-1 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50"
                      disabled={isProcessing}
                      onClick={() => handleReject(r.requestId)}
                    >
                      {isProcessing ? 'Working…' : 'Reject'}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default CoordinatorAdvisorInbox;
