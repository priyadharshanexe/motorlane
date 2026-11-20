from ..models import Profile


def rental_profile(user):
    """The marketplace profile for an auth user, created on first use."""
    profile, _ = Profile.objects.get_or_create(user=user)
    return profile
