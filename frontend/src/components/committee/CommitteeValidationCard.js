import React from 'react';

const CommitteeValidationCard = ({ validationResult, onPublishClick, disabled }) => {
  const isValid = validationResult?.valid === true;
  return (
    <section className="committee-validation-card" data-testid="committee-validation-card">
      <h2>Committee Validation</h2>
      {!validationResult ? (
        <p data-testid="validation-placeholder">Validation not performed yet.</p>
      ) : (
        <>
          <div className={`validation-status ${isValid ? 'valid' : 'invalid'}`} data-testid="validation-status">
            {isValid ? 'Valid committee configuration' : 'Invalid committee configuration'}
          </div>
          {!isValid && validationResult?.missingRequirements?.length > 0 && (
            <div className="validation-missing" data-testid="missing-requirements">
              <p>Missing requirements:</p>
              <ul>
                {validationResult.missingRequirements.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            onClick={onPublishClick}
            disabled={!isValid || disabled}
            data-testid="publish-button"
          >
            Publish Committee
          </button>
        </>
      )}
    </section>
  );
};

export default CommitteeValidationCard;
