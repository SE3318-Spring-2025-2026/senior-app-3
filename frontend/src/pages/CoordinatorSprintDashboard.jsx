import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { getAllGroups } from '../api/groupService';
import {
  getLatestSyncJob,
  getSyncJobLogs,
  getSyncJobById,
  pollSyncJobUntilTerminal,
  recalculateContributions,
  triggerGithubSync,
  triggerJiraSync,
} from '../api/sprintTrackingService';
import SprintSelector from '../components/coordinator-sprint/SprintSelector';
import SyncActionButtons from '../components/coordinator-sprint/SyncActionButtons';
import JobStatusPanel from '../components/coordinator-sprint/JobStatusPanel';
import ContributionResultsTable from '../components/coordinator-sprint/ContributionResultsTable';

const CoordinatorSprintDashboard = () => {
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedSprintId, setSelectedSprintId] = useState('');
  const [jobs, setJobs] = useState([]);
  const [jobLogs, setJobLogs] = useState({});
  const [summary, setSummary] = useState(null);
  const [globalError, setGlobalError] = useState('');

  const [jiraLoading, setJiraLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [recalcLoading, setRecalcLoading] = useState(false);

  const refreshGroups = async () => {
    setGroupsLoading(true);
    try {
      const response = await getAllGroups();
      const loadedGroups = response.groups || [];
      setGroups(loadedGroups);
    } catch (error) {
      setGlobalError(error?.response?.data?.message || 'Failed to load groups.');
    } finally {
      setGroupsLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      setGroupsLoading(true);
      try {
        const response = await getAllGroups();
        if (!mounted) return;
        setGroups(response.groups || []);
      } catch (error) {
        if (!mounted) return;
        setGlobalError(error?.response?.data?.message || 'Failed to load groups.');
      } finally {
        if (mounted) setGroupsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const activeGroup = useMemo(
    () => groups.find((group) => group.groupId === selectedGroupId) || null,
    [groups, selectedGroupId]
  );
  const hasJiraIntegration = Boolean(activeGroup?.jiraProjectId || activeGroup?.projectKey);
  const hasGithubIntegration = Boolean(activeGroup?.githubOrg && activeGroup?.githubRepoName);

  const addOrUpdateJob = (incomingJob) => {
    setJobs((prev) => {
      const existingIndex = prev.findIndex((job) => job.source === incomingJob.source);
      if (existingIndex === -1) return [incomingJob, ...prev];
      const copy = [...prev];
      copy[existingIndex] = { ...copy[existingIndex], ...incomingJob };
      return copy;
    });
  };

  const ensureSelection = () => {
    if (!selectedGroupId || !selectedSprintId) {
      setGlobalError('Please select both group and sprint before running an action.');
      return false;
    }
    setGlobalError('');
    return true;
  };

  const handleRunJiraSync = async () => {
    if (!ensureSelection()) return;
    if (!hasJiraIntegration) {
      setGlobalError('JIRA integration is not configured for this group. Configure JIRA first.');
      return;
    }
    setJiraLoading(true);
    try {
      const initialJob = await triggerJiraSync({
        groupId: selectedGroupId,
        sprintId: selectedSprintId,
        coordinatorId: user?.userId || '',
        jiraBoardId: activeGroup?.jiraProjectId || activeGroup?.projectKey,
        sprintKey: selectedSprintId,
      });
      addOrUpdateJob(initialJob);

      const finalJob = await pollSyncJobUntilTerminal({
        source: 'jira',
        groupId: selectedGroupId,
        sprintId: selectedSprintId,
        jobId: initialJob.jobId,
        onTick: addOrUpdateJob,
      });
      addOrUpdateJob(finalJob);
    } catch (error) {
      setGlobalError(error?.response?.data?.message || error?.message || 'JIRA sync failed to start.');
    } finally {
      setJiraLoading(false);
    }
  };

  const handleRunGithubSync = async () => {
    if (!ensureSelection()) return;
    if (!hasGithubIntegration) {
      setGlobalError('GitHub integration is not configured for this group. Configure GitHub first.');
      return;
    }
    setGithubLoading(true);
    try {
      const repositorySlug = `${activeGroup.githubOrg}/${activeGroup.githubRepoName}`;

      const initialJob = await triggerGithubSync({
        groupId: selectedGroupId,
        sprintId: selectedSprintId,
        coordinatorId: user?.userId || '',
        repositorySlug,
      });
      addOrUpdateJob(initialJob);

      const finalJob = await pollSyncJobUntilTerminal({
        source: 'github',
        groupId: selectedGroupId,
        sprintId: selectedSprintId,
        jobId: initialJob.jobId,
        onTick: addOrUpdateJob,
      });
      addOrUpdateJob(finalJob);
    } catch (error) {
      setGlobalError(error?.response?.data?.message || error?.message || 'GitHub sync failed to start.');
    } finally {
      setGithubLoading(false);
    }
  };

  const handleRecalculate = async () => {
    if (!ensureSelection()) return;
    setRecalcLoading(true);
    try {
      const result = await recalculateContributions({
        groupId: selectedGroupId,
        sprintId: selectedSprintId,
        triggeredBy: user?.userId || '',
      });
      setSummary(result);
    } catch (error) {
      setGlobalError(error?.response?.data?.message || error?.message || 'Contribution recalculation failed.');
    } finally {
      setRecalcLoading(false);
    }
  };

  const handleViewLogs = async (job) => {
    // Toggle: if logs for this source are already shown, hide them
    if (jobLogs[job.source]) {
      setJobLogs((prev) => {
        const copy = { ...prev };
        delete copy[job.source];
        return copy;
      });
      return;
    }

    try {
      const details = job?.jobId
        ? await getSyncJobById({
            source: job.source,
            groupId: selectedGroupId,
            sprintId: selectedSprintId,
            jobId: job.jobId,
          })
        : await getLatestSyncJob({
            source: job.source,
            groupId: selectedGroupId,
            sprintId: selectedSprintId,
          });

      const logs = job?.jobId
        ? await getSyncJobLogs({
            source: job.source,
            groupId: selectedGroupId,
            sprintId: selectedSprintId,
            jobId: job.jobId,
          })
        : { logs: [] };

      setJobLogs((prev) => ({
        ...prev,
        [job.source]: {
          ...details,
          logs: logs.logs || [],
        },
      }));
    } catch (error) {
      setGlobalError(error?.response?.data?.message || error?.message || 'Failed to fetch job logs.');
    }
  };

  if (!isAuthenticated) return <Navigate to="/auth/login" replace />;
  if (user?.role !== 'coordinator') return <Navigate to="/unauthorized" replace />;

  return (
    <div className="page p-6 bg-slate-50 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-5">
        <header>
          <h1 className="text-2xl font-bold text-slate-900">Coordinator Sprint Tracking Dashboard</h1>
          <p className="text-sm text-slate-600 mt-1">
            Ingest (JIRA/GitHub) → Process (Recalculate) → Display (Contribution table)
          </p>
        </header>

        {globalError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {globalError}
          </div>
        )}

        <SprintSelector
          groups={groups}
          selectedGroupId={selectedGroupId}
          selectedSprintId={selectedSprintId}
          onGroupChange={(groupId) => {
            setSelectedGroupId(groupId);
            setSummary(null);
            setJobs([]);
            setJobLogs({});
          }}
          onSprintChange={(sprintId) => {
            setSelectedSprintId(sprintId);
            setSummary(null);
            setJobs([]);
            setJobLogs({});
          }}
          loadingGroups={groupsLoading}
          onSprintsRefresh={refreshGroups}
        />

        <SyncActionButtons
          disabled={!selectedGroupId || !selectedSprintId}
          jiraDisabled={!hasJiraIntegration}
          githubDisabled={!hasGithubIntegration}
          jiraLoading={jiraLoading}
          githubLoading={githubLoading}
          recalcLoading={recalcLoading}
          onRunJiraSync={handleRunJiraSync}
          onRunGithubSync={handleRunGithubSync}
          onRecalculate={handleRecalculate}
        />

        {(selectedGroupId && (!hasJiraIntegration || !hasGithubIntegration)) && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {!hasJiraIntegration && <p>JIRA sync is unavailable: this group has no JIRA integration yet.</p>}
            {!hasGithubIntegration && <p>GitHub sync is unavailable: this group has no GitHub integration yet.</p>}
          </div>
        )}

        <JobStatusPanel jobs={jobs} onViewLogs={handleViewLogs} logDetailsBySource={jobLogs} />
        <ContributionResultsTable summary={summary} />
      </div>
    </div>
  );
};

export default CoordinatorSprintDashboard;
