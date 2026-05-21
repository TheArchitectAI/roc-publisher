import {
  afterLinkedinCompanyPreventRemove,
  linkedinCompanyPreventRemove,
} from './linkedin.company.prevent.remove';

describe('linkedinCompanyPreventRemove', () => {
  it('preserves a LinkedIn company mention through HTML conversion', () => {
    const protectedText = linkedinCompanyPreventRemove(
      'Follow @[Postiz](urn:li:organization:12345) today'
    );

    expect(afterLinkedinCompanyPreventRemove(protectedText)).toBe(
      'Follow <strong>@Postiz</strong> today'
    );
  });
});
