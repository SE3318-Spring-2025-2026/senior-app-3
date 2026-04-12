# Phase 1: Requirements Document

| Functional Requirements | Non-Functional Requirements | Integration Requirements |
| :--- | :--- | :--- |
| 1. The system shall allow students to register using valid student IDs that were previously uploaded by the coordinator. | **Expected Response Time** | • The system shall integrate with GitHub via NextAuth.js or a similar OAuth framework for user authentication. |
| 2. The system shall require students to connect their GitHub accounts to fetch their usernames. | • Page load response times shall be under 2 seconds. | • The system shall integrate with JIRA to bind spaces to teams and fetch issue keys, assignees, and active story data. |
| 3. The system shall allow a student to create a group, automatically appointing them as the team leader for the first sprint. | • External API queries (GitHub/JIRA) shall complete within 5 seconds. | • The system shall integrate with GitHub Organizations using Personal Access Tokens (PAT) to obtain related Pull Requests and check merge statuses. |
| 4. The system shall allow the team leader to make an Advisee Request to a Professor. | **Timing Considerations** | |
| 5. The system shall require the coordinator to create an evaluation rubric based on binary or soft grading criteria. | • The system shall execute daily synchronizations to fetch active stories in a sprint. | |
| 6. The system shall allow coordinators to set per-sprint story point requirements for each student. | • Processes like group creation and submissions shall be strictly bounded by schedules set by the Coordinator. | |
| 7. The system shall allow coordinators to assign advisors to committees. | **Levels of Security** | |
| 8. The system shall restrict proposal submissions to only those groups that are assigned to a committee. | • Authentication: Users shall authenticate securely using an OAuth framework. | |
| 9. The system shall allow committee members to review, leave comments, and grade proposals. | • Access Control: Professors shall be required to request a password change upon their initial login. Admins shall generate one-time-use password reset links that expire after 15 minutes. | |
| 10. The system shall calculate individual grades based on the ratio of completed story points. ||
| | **Error Detection and Recovery** | |
| | • Data Sanitization: If a group fails to secure an advisor, the system shall automatically trigger a sanitization protocol to disband the group. | |
| | • API Fallback: In the event of an external API timeout, the system shall retry the connection up to 3 times before logging a synchronization error. | |

---

# Phase 2: Business Process Mapping
**Senior Project Management System**

## Deliverable 1: Critical Business Processes Overview

The following table identifies the specific critical workflows required to initialize groups, manage deliverables, and track individual contributions. General JIRA integrations have been removed; JIRA is now strictly isolated to story point tracking.

| PROCESS | DESCRIPTION | SYSTEM COMPONENTS INVOLVED |
| :--- | :--- | :--- |
| **0. Registration** | Students register using coordinator-provided valid IDs; account creation and identity verification occur here. | Frontend, Backend, Database |
| **1. Onboarding & Security** | Onboarding steps including GitHub OAuth connection, professor password flow, and admin one-time reset links. | Frontend, Backend, OAuth/GitHub Integration |
| **2. Group Creation** | Students form groups, invite members, and establish the team leader. | Frontend, Backend, Database |
| **3. Advisor Association** | Formed groups request an advisor, process approvals, and handle system sanitization for unmatched groups. | Frontend, Backend, Database |
| **4. Committee Assignment** | The coordinator assigns advisors to committees to evaluate multiple groups. | Frontend (Coordinator Panel), Backend, Database |
| **5. Deliverable Submission** | Groups assigned to a committee submit their project deliverables (e.g., initial proposal, statement of work, demonstration). | Frontend, Backend, Document Storage |
| **6. Deliverable Review** | Committee members read and discuss the submitted deliverable content, leave comments, and request clarifications. | Frontend, Backend, Database |
| **7. Deliverable Evaluation** | Committee members apply the evaluation rubric to score the specific deliverables; results are recorded. | Frontend, Backend, Database |
| **8. Sprint Tracking** | System fetches story point estimates and related issue metadata from JIRA for sprints. | Backend, JIRA API, Database |
| **9. Sprint Contribution** | System validates PR merges and maps completed story points to individual students to compute contribution ratios. | Backend, GitHub API, Database |
| **10. Coordinator Configuration** | Coordinator configures rubrics and per-sprint story point targets for students. | Frontend (Coordinator Panel), Backend, Database | 
| **11. Calculating the Final Grade** | System aggregates the group's deliverable scores and applies individual sprint contribution ratios to calculate the final individual grades. | Backend, Database |

> **Why this matters:** Separating registration vs onboarding, review vs evaluation, and tracking vs contribution improves clarity of responsibilities and implementation scope for each component.

---

## Deliverable 2: Mapping Processes to Components (Decomposition)

Below is the atomic breakdown of each isolated process. Each row represents a specific system action and potential API endpoint.

### 0. Registration
*This process must run before onboarding and Group Creation.*

| PROCESS STEP | SYSTEM COMPONENT | DATA REQUIRED |
| :--- | :--- | :--- |
| Coordinator uploads valid student IDs to the system | Frontend (Coordinator Panel) + Backend + DB | `csv/file of student_ids`, `coordinator_id` |
| Student registers using a valid student ID (account creation) | Frontend + Backend + DB | `student_id`, `email`, `password` (or OAuth flag) |
| System validates student ID and activates account (email verification) | Backend + Email Service + DB | `student_id`, `verification_token` |
| Student may choose local auth or OAuth after registration | Frontend + Backend + OAuth Provider | `auth_method`, `provider_token`

### 1. Onboarding & Security
*Post-registration steps to complete user profile and enforce security policies.*

| PROCESS STEP | SYSTEM COMPONENT | DATA REQUIRED |
| :--- | :--- | :--- |
| Student connects GitHub account during onboarding (OAuth) | Frontend + Backend + GitHub OAuth | `github_oauth_token`, `student_id` |
| System verifies GitHub username and associates it with student profile | Backend + GitHub API + DB | `github_username`, `student_id` |
| Professors are required to change password on first login | Frontend + Backend + DB | `professor_id`, `temporary_password_flag` |
| Admin can generate one-time password-reset links that expire after 15 minutes | Frontend (Admin Panel) + Backend | `admin_id`, `target_user_id`, `one_time_token`, `expiry_timestamp` |

### 2. Group Creation
*This process is bounded by a schedule set by the Coordinator.*

| PROCESS STEP | SYSTEM COMPONENT | DATA REQUIRED |
| :--- | :--- | :--- |
| Student creates a group and is automatically appointed Team Leader | Frontend + Backend + DB | `student_id`, `group_name` |
| Team Leader adds members to the group | Frontend + Backend | `group_id`, `target_student_id` |
| System notifies added students in the notifications section | Backend + Notification Svc | `notification_payload`, `student_id` |
| Student approves the group request | Frontend + Backend + DB | `request_id`, `student_id` |
| System automatically denies other awaiting requests for that student | Backend + DB | `student_id`, `pending_request_ids` |
| Team Leader sets up GitHub Integration | Frontend + Backend + GitHub API | `group_id`, `github_pat` |
| Team Leader sets up JIRA Integration (Strictly for Story Point retrieval) | Frontend + Backend + JIRA API | `group_id`, `jira_credentials` |
| Coordinator manually adds/removes a student (Override) | Backend + DB | `coordinator_id`, `group_id`, `student_id` |

### 3. Group - Advisor Association
*This process requires the Group Creation to be completed and is bounded by a schedule.*

| PROCESS STEP | SYSTEM COMPONENT | DATA REQUIRED |
| :--- | :--- | :--- |
| Team Leader makes an Advisee Request to a Professor | Frontend + Backend + DB | `group_id`, `professor_id` |
| System notifies the Advisor | Backend + Notification Svc | `professor_id`, `request_details` |
| Advisor approves the request and is matched with the group | Frontend + Backend + DB | `request_id`, `approval_status` |
| Advisor releases the team (if needed for a new request) | Frontend + Backend + DB | `group_id`, `professor_id` |
| Coordinator transfers a group to another advisor | Backend + DB | `group_id`, `new_professor_id` |
| System executes Sanitization protocol to disband groups without an advisor | Backend + DB | `schedule_deadline`, `group_ids` |

### 4. Committee Assignment
*Requires both Group Creation and Group-Advisor Association to be completed.*

| PROCESS STEP | SYSTEM COMPONENT | DATA REQUIRED |
| :--- | :--- | :--- |
| Coordinator creates a committee | Frontend + Backend + DB | `committee_name` |
| Coordinator assigns advisors to the committee | Frontend + Backend + DB | `committee_id`, `advisor_ids` |
| Coordinator assigns additional jury members | Frontend + Backend + DB | `committee_id`, `jury_ids` |

### 5. Deliverable Submission
*Bounded by a schedule; requires Committee Assignment. Individual students cannot submit. This applies to all project phases (e.g., proposal, statement of work, demonstration).*

| PROCESS STEP | SYSTEM COMPONENT | DATA REQUIRED |
| :--- | :--- | :--- |
| System validates if the group is assigned to a committee | Backend + DB | `group_id`, `committee_status` |
| Group submits the deliverable document | Frontend + Backend + Storage | `group_id`, `deliverable_type`, `document_file/markdown` |

### 6. Deliverable Review
*Committee members read and discuss the deliverable content (e.g., proposal details, architecture choices) and provide commentary.*

| PROCESS STEP | SYSTEM COMPONENT | DATA REQUIRED |
| :--- | :--- | :--- |
| Committee members open and read the submitted deliverable | Frontend + Backend | `deliverable_id`, `reviewer_user_id` |
| Committee members leave comments and request clarifications | Frontend + Backend + DB | `deliverable_id`, `comment_markdown`, `author_id` |
| Committee members mark specific sections as 'needs clarification' or 'ok' | Frontend + Backend + DB | `deliverable_id`, `section_id`, `status` |
| Coordinator/Team receives clarification requests and can resubmit | Frontend + Backend + Storage | `deliverable_id`, `resubmission_flag` |

### 7. Deliverable Evaluation
*Separate from review: apply rubric-based scoring to the specific deliverable (e.g., grading the proposal) and record the scores.*

| PROCESS STEP | SYSTEM COMPONENT | DATA REQUIRED |
| :--- | :--- | :--- |
| Coordinator-created rubric is referenced for scoring | Frontend (Committee UI) + Backend + DB | `rubric_id`, `rubric_definition` |
| Committee members assign rubric scores to the deliverable | Frontend + Backend + DB | `deliverable_id`, `rubric_scores`, `reviewer_user_id` |
| System aggregates rubric scores and computes final score for that deliverable | Backend + DB | `deliverable_id`, `aggregated_score` |

### 8. Sprint Tracking (Story Points Retrieval)
*Responsible for fetching story-point and issue metadata from JIRA on a schedule.*

| PROCESS STEP | SYSTEM COMPONENT | DATA REQUIRED |
| :--- | :--- | :--- |
| Scheduled job fetches active sprint issues and story points from JIRA | Backend + JIRA API + DB | `sprint_id`, `issue_keys`, `story_points` |
| System retries external API up to configured retries on failure | Backend | `retry_count`, `last_error` |
| Store issue-to-sprint mapping and story point values in DB | Backend + DB | `issue_key`, `sprint_id`, `story_points` |

### 9. Sprint Contribution (Mapping & Calculation)
*Responsible for validating GitHub activity and mapping completed story points to students.*

| PROCESS STEP | SYSTEM COMPONENT | DATA REQUIRED |
| :--- | :--- | :--- |
| For each issue, system verifies associated PRs and merge status via GitHub API | Backend + GitHub API + DB | `issue_key`, `pr_id`, `merge_status` |
| Map merged PRs to contributing GitHub usernames and then to students | Backend + DB | `pr_id`, `github_username`, `student_id` |
| Calculate completed story points per student (sum of mapped issues) | Backend + DB | `student_id`, `completed_story_points` |
| Compute contribution ratio = completed_story_points / target_story_points | Backend + DB | `student_id`, `ratio` |
| Persist contribution records and expose via API for grade calculations | Backend + DB + API | `student_id`, `ratio`, `sprint_id` |

### 10. Coordinator Configuration (Rubrics & Sprint Targets)
*Coordinator-managed configuration tasks required before review and sprint tracking.*

| PROCESS STEP | SYSTEM COMPONENT | DATA REQUIRED |
| :--- | :--- | :--- |
| Coordinator creates evaluation rubric (binary or soft criteria) | Frontend (Coordinator Panel) + Backend + DB | `rubric_id`, `rubric_definition`, `coordinator_id` |
| Coordinator sets per-sprint story point requirements for each student | Frontend (Coordinator Panel) + Backend + DB | `sprint_id`, `student_id`, `target_story_points` |
| Coordinator reviews and publishes the configuration for the sprint | Frontend + Backend | `sprint_id`, `configuration_status` |

### 11. Calculating the Final Grade
*This process combines the group's overall deliverable evaluations with the individual student's sprint tracking data (Story Points completed).*

| PROCESS STEP | SYSTEM COMPONENT | DATA REQUIRED |
| :--- | :--- | :--- |
| System fetches aggregated scores for all evaluated deliverables of the group | Backend + DB | `group_id`, `deliverable_scores` |
| System fetches the individual completion ratio based on sprint tracking | Backend + DB | `student_id`, `sprint_completion_ratio` |
| System calculates individual final grade (e.g., Base Group Score * Individual Ratio) | Backend + DB | `student_id`, `group_id`, `final_grade` |
| System logs the final grade and marks the student's evaluation as complete | Backend + DB | `student_id`, `final_grade_status`, `timestamp` |
---