# Group Dashboard Implementation

## Overview
This implementation provides a complete group-facing dashboard that displays real-time group state, including member information, GitHub and JIRA integration status, and pending approval counts.

## Architecture

### Components

1. **GroupDashboard.js** - Main dashboard component
   - Route: `/groups/{group_id}`
   - Displays overall group state
   - Handles real-time polling (30s interval)
   - Shows integration status cards and member list
   - Coordinator-only "Coordinator Panel" link

2. **GroupMemberList.js** - Member list component
   - Displays all group members with:
     - Member ID
     - Name
     - Role (Leader/Member badge)
     - Status (Active/Pending/Rejected)
     - Join date
   - Responsive table layout

3. **GitHubStatusCard.js** - GitHub integration status
   - Shows connection status (Connected/Disconnected)
   - Displays repository URL (linked)
   - Shows last sync timestamp

4. **JiraStatusCard.js** - JIRA integration status
   - Shows connection status (Connected/Disconnected)
   - Displays project key
   - Shows board URL (linked)

5. **CoordinatorPanel.js** - Placeholder for coordinator-specific features
   - Route: `/groups/{group_id}/coordinator`
   - Restricted to coordinator role

### Services

**groupService.js** - API integration layer
- `getGroup()` - Fetch group details
- `getGroupMembers()` - Fetch member list
- `getGitHubStatus()` - Fetch GitHub integration status
- `getJiraStatus()` - Fetch JIRA integration status
- `getPendingApprovals()` - Fetch pending approval count
- `getGroupDashboardData()` - Fetch all dashboard data in parallel

### State Management

**groupStore.js** - Zustand store for group state
- State: groupData, members, github, jira, pendingApprovalsCount, isLoading, error, lastUpdated
- Actions: fetchGroupDashboard, startPolling, stopPolling, clearGroupData
- Features:
  - Automatic polling for real-time updates (configurable interval)
  - Error handling with fallback defaults
  - Loading state management

## Data Flow

```
GroupDashboard Component
    ↓
useGroupStore (Zustand)
    ↓
groupService.js (API calls)
    ↓
apiClient.js (Axios interceptor)
    ↓
Backend API Endpoints:
  - GET /groups/{groupId}
  - GET /groups/{groupId}/members
  - GET /groups/{groupId}/github
  - GET /groups/{groupId}/jira
  - GET /groups/{groupId}/approvals
```

## Features

### Real-Time Updates
- Automatic polling every 30 seconds
- Manual refresh button
- Last updated timestamp display
- Graceful error handling

### Responsive Design
- Grid layout that adapts to screen size
- Mobile-friendly member list
- Collapsible on smaller screens

### Access Control
- All routes protected by ProtectedRoute
- Coordinator Panel visible only to users with 'coordinator' or 'admin' role
- Role-based UI elements (leader vs member badges)

### User Experience
- Loading states with spinner animation
- Error messages with context
- Empty state handling
- Visual feedback for integration status (color-coded badges)
- Last updated timestamp

## API Endpoints Required

The dashboard expects the following API endpoints to be available:

### 1. GET /groups/{groupId}
Response:
```json
{
  "groupId": "string",
  "groupName": "string",
  "leaderId": "string",
  "createdAt": "ISO 8601 date",
  "memberCount": "integer",
  "status": "active|inactive|archived",
  "integrations": {
    "github": "boolean",
    "jira": "boolean"
  }
}
```

### 2. GET /groups/{groupId}/members
Response:
```json
{
  "groupId": "string",
  "members": [
    {
      "memberId": "string",
      "studentId": "string",
      "studentName": "string",
      "joinedAt": "ISO 8601 date",
      "status": "active|pending|rejected",
      "role": "leader|member"
    }
  ]
}
```

### 3. GET /groups/{groupId}/github
Response:
```json
{
  "connected": "boolean",
  "repo_url": "string|null",
  "last_synced": "ISO 8601 date|null"
}
```

### 4. GET /groups/{groupId}/jira
Response:
```json
{
  "connected": "boolean",
  "project_key": "string|null",
  "board_url": "string|null"
}
```

### 5. GET /groups/{groupId}/approvals
Query Parameters:
- status=pending (filter parameter)

Response:
```json
{
  "approvals": [
    {
      "requestId": "string",
      "groupId": "string",
      "studentId": "string",
      "groupName": "string",
      "leaderName": "string",
      "status": "pending|approved|rejected",
      "createdAt": "ISO 8601 date",
      "expiresAt": "ISO 8601 date"
    }
  ]
}
```

## Usage

### Navigate to Group Dashboard
```tsx
// From anywhere in the app
navigate(`/groups/${groupId}`);

// Or use a link
<Link to={`/groups/${groupId}`}>View Group</Link>
```

### Access Group Store
```tsx
import useGroupStore from '../store/groupStore';

function MyComponent() {
  const { groupData, members, github, jira, pendingApprovalsCount } = useGroupStore();
  
  // Use the data...
}
```

### Fetch Group Data Manually
```tsx
import * as groupService from '../api/groupService';

const data = await groupService.getGroupDashboardData(groupId);
```

## Styling

The dashboard uses a clean, modern design with:
- White cards on light gray background
- Color-coded status badges (green for connected, red for disconnected)
- Professional typography and spacing
- Smooth transitions and hover effects
- Mobile-responsive layout

CSS file: `GroupDashboard.css`

## Error Handling

The dashboard gracefully handles:
- Missing endpoints (returns defaults)
- Network errors (displays error message)
- Partial data loading (shows available data, hides unavailable sections)
- Polling backoff on errors

## Performance Considerations

- Parallel API calls using Promise.all()
- Polling interval configurable (default 30s)
- Efficient state updates using Zustand
- Cleanup of polling intervals on component unmount
- Request deduplication via Axios interceptor

## Future Enhancements

1. **Coordinator Panel Features:**
   - Approve/reject pending member requests
   - Configure GitHub integration
   - Configure JIRA integration
   - View and manage group settings
   - Audit log viewing

2. **Additional Integrations:**
   - Discord/Slack notifications
   - Email notifications
   - Calendar integration

3. **Analytics:**
   - Group activity timeline
   - Member contribution tracking
   - Integration usage statistics

4. **Permissions:**
   - Fine-grained role-based access
   - Member-specific permissions
   - Audit trail

## Testing

Example test structure:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import GroupDashboard from './GroupDashboard';
import useGroupStore from '../store/groupStore';

// Mock the store
jest.mock('../store/groupStore');

test('displays group dashboard', async () => {
  useGroupStore.mockReturnValue({
    groupData: { groupName: 'Test Group' },
    members: [],
    github: { connected: false },
    jira: { connected: false },
    pendingApprovalsCount: 0,
    isLoading: false,
    error: null,
    // ... other methods
  });

  render(<GroupDashboard />);
  
  await waitFor(() => {
    expect(screen.getByText('Test Group')).toBeInTheDocument();
  });
});
```

## File Structure

```
frontend/
├── src/
│   ├── api/
│   │   ├── apiClient.js (existing)
│   │   └── groupService.js (new)
│   ├── components/
│   │   ├── GroupDashboard.js (new)
│   │   ├── GroupDashboard.css (new)
│   │   ├── GroupMemberList.js (new)
│   │   ├── GitHubStatusCard.js (new)
│   │   ├── JiraStatusCard.js (new)
│   │   └── CoordinatorPanel.js (new)
│   ├── store/
│   │   ├── authStore.js (existing)
│   │   └── groupStore.js (new)
│   └── App.js (modified)
```

## Acceptance Criteria Met

✅ Dashboard loads and displays all group data from GET /groups/{group_id}
✅ Member list shows all current members with correct role labels
✅ GitHub card shows connected: true/false and repo_url when connected
✅ JIRA card shows connected: true/false and board_url when connected
✅ Pending approvals badge shows correct count from the approvals endpoint
✅ Dashboard is accessible to all group members
✅ Coordinator Panel link visible only to coordinators
✅ Real-time polling implemented (30s interval)

## Dependencies

- React 18.2.0+
- React Router v6+
- Axios 1.3.0+
- Zustand 4.3.7+
