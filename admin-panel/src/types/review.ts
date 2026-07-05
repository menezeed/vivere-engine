export type UserRole = 'viewer' | 'reviewer' | 'admin';
export type ProposalStatus = 'pending_review' | 'approved' | 'rejected' | 'promoted';
export type ReviewAction = 'approve' | 'reject' | 'promote';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}
