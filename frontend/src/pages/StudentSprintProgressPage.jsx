import React from 'react';
import { Link, useParams } from 'react-router-dom';
import SprintProgressCard from '../components/SprintProgressCard';
import './StudentSprintProgressPage.css';

const StudentSprintProgressPage = () => {
  const { group_id: groupId, sprint_id: sprintId } = useParams();

  return (
    <main className="student-sprint-progress-page">
      <div className="student-sprint-progress-inner">
        <Link className="student-sprint-progress-back" to={`/groups/${groupId}`}>
          Back to group
        </Link>
        <SprintProgressCard groupId={groupId} sprintId={sprintId} />
      </div>
    </main>
  );
};

export default StudentSprintProgressPage;
