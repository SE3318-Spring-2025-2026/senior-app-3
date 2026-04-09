/**
 * Committee Validation Tests
 *
 * Covers:
 *  - POST /committees/{committeeId}/validate
 *  - Role guard (coordinator only)
 *  - Committee existence check
 *  - Validation rules: min advisors, min jury, no overlap
 *  - Status update on valid
 */

const mongoose = require('mongoose');
const { validateCommitteeSetup } = require('../src/controllers/committees');
const Committee = require('../src/models/Committee');

describe('validateCommitteeSetup', () => {
  let mockReq, mockRes;

  beforeEach(() => {
    mockReq = {
      params: { committeeId: 'test-committee' },
      user: { role: 'coordinator' }
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('should return 403 for non-coordinator', async () => {
    mockReq.user.role = 'student';
    await validateCommitteeSetup(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({ code: 'FORBIDDEN', message: 'Coordinator role required' });
  });

  it('should return 404 for non-existent committee', async () => {
    Committee.findOne = jest.fn().mockResolvedValue(null);
    await validateCommitteeSetup(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({ code: 'COMMITTEE_NOT_FOUND', message: 'Committee not found' });
  });

  it('should return valid true for complete committee', async () => {
    const mockCommittee = {
      committeeId: 'test-committee',
      advisorIds: ['advisor1'],
      juryIds: ['jury1'],
      status: 'draft',
      save: jest.fn().mockResolvedValue()
    };
    Committee.findOne = jest.fn().mockResolvedValue(mockCommittee);
    await validateCommitteeSetup(mockReq, mockRes);
    expect(mockCommittee.save).toHaveBeenCalled();
    expect(mockCommittee.status).toBe('validated');
    expect(mockRes.json).toHaveBeenCalledWith({
      committeeId: 'test-committee',
      valid: true,
      missingRequirements: [],
      checkedAt: expect.any(Date)
    });
  });

  it('should return valid false with missingRequirements for insufficient advisors', async () => {
    const mockCommittee = {
      committeeId: 'test-committee',
      advisorIds: [],
      juryIds: ['jury1'],
      status: 'draft'
    };
    Committee.findOne = jest.fn().mockResolvedValue(mockCommittee);
    await validateCommitteeSetup(mockReq, mockRes);
    expect(mockRes.json).toHaveBeenCalledWith({
      committeeId: 'test-committee',
      valid: false,
      missingRequirements: ['Minimum 1 advisor(s) required'],
      checkedAt: expect.any(Date)
    });
  });

  it('should return valid false for overlap between advisors and jury', async () => {
    const mockCommittee = {
      committeeId: 'test-committee',
      advisorIds: ['user1'],
      juryIds: ['user1'],
      status: 'draft'
    };
    Committee.findOne = jest.fn().mockResolvedValue(mockCommittee);
    await validateCommitteeSetup(mockReq, mockRes);
    expect(mockRes.json).toHaveBeenCalledWith({
      committeeId: 'test-committee',
      valid: false,
      missingRequirements: ['No person can be both advisor and jury member'],
      checkedAt: expect.any(Date)
    });
  });
});