import React from 'react';

/**
 * Group Member List Component
 * Displays all members of the group with their roles and status
 */
const GroupMemberList = ({ members, isLoading, groupLeaderId }) => {
  if (isLoading) {
    return (
      <div className="members-section">
        <div className="loading">Loading members...</div>
      </div>
    );
  }

  const memberList = Array.isArray(members) ? members : [];

  if (memberList.length === 0) {
    return (
      <div className="members-section">
        <div className="empty-state">
          <p>No members found in this group yet.</p>
        </div>
      </div>
    );
  }

  const mapStatus = (status) => {
    switch (status?.toLowerCase()) {
      case 'active':
        return { label: 'Active', className: 'active' };
      case 'pending':
        return { label: 'Pending', className: 'pending' };
      case 'approved':
        return { label: 'Approved', className: 'active' };
      case 'rejected':
        return { label: 'Rejected', className: 'pending' };
      default:
        return { label: status || 'Unknown', className: 'pending' };
    }
  };

  return (
    <div className="members-section">
      <div className="members-header">
        <h3>Group Members</h3>
        <span className="members-count">{memberList.length} member{memberList.length !== 1 ? 's' : ''}</span>
      </div>

      <table className="members-table">
        <thead>
          <tr>
            <th>Member ID</th>
            <th>Name</th>
            <th>Role</th>
            <th>Status</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {memberList.map((member, index) => {
            const role = member.role?.toLowerCase() === 'leader' ? 'leader' : 'member';
            const statusInfo = mapStatus(member.status);
            const joinedDate = member.joinedAt
              ? new Date(member.joinedAt).toLocaleDateString()
              : 'N/A';

            return (
              <tr key={member.memberId || index}>
                <td>{member.memberId || member.studentId || member.userId || 'N/A'}</td>
                <td>{member.studentName || 'Unknown'}</td>
                <td>
                  <span className={`role-badge ${role}`}>
                    {role.charAt(0).toUpperCase() + role.slice(1)}
                  </span>
                </td>
                <td>
                  <span className={`member-status ${statusInfo.className}`}>
                    <span className="status-dot" style={{
                      backgroundColor: statusInfo.className === 'active' ? '#238636' : '#9e6a03',
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      display: 'inline-block'
                    }} />
                    {statusInfo.label}
                  </span>
                </td>
                <td>{joinedDate}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default GroupMemberList;
