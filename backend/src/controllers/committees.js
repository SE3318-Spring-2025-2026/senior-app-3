const Committee = require('../models/Committee');

const validateCommitteeSetup = async (req, res) => {
  const { committeeId } = req.params;
  const user = req.user; // assume auth middleware sets this

  if (user.role !== 'coordinator') {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Coordinator role required' });
  }

  const committee = await Committee.findOne({ committeeId });
  if (!committee) {
    return res.status(404).json({ code: 'COMMITTEE_NOT_FOUND', message: 'Committee not found' });
  }

  const missingRequirements = [];
  const minAdvisors = 1; // configurable
  const minJury = 1;

  if (committee.advisorIds.length < minAdvisors) {
    missingRequirements.push(`Minimum ${minAdvisors} advisor(s) required`);
  }

  if (committee.juryIds.length < minJury) {
    missingRequirements.push(`Minimum ${minJury} jury member(s) required`);
  }

  const overlap = committee.advisorIds.filter(id => committee.juryIds.includes(id));
  if (overlap.length > 0) {
    missingRequirements.push('No person can be both advisor and jury member');
  }

  const valid = missingRequirements.length === 0;

  if (valid) {
    committee.status = 'validated';
    await committee.save();
  }

  res.json({
    committeeId,
    valid,
    missingRequirements,
    checkedAt: new Date()
  });
};

module.exports = { validateCommitteeSetup };