"""
URL configuration for vehicle_rental project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerSplitView

from rental.health import healthz, readyz
from rental.media import serve_media
from django.urls import path, include, re_path
from rental.views import react_app
from django.views.generic import RedirectView
from django.templatetags.static import static as static_url
from django.conf import settings

urlpatterns = [
    path("favicon.ico", RedirectView.as_view(url=static_url("rental/favicon.ico")), name="favicon"),
    path('healthz', healthz, name='healthz'),
    path('readyz', readyz, name='readyz'),
    path('admin/', admin.site.urls),
    path('accounts/', include('allauth.urls')),
    path('auth/', include('allauth.headless.urls')),
    re_path(r'^app(?:/.*)?$', react_app, name='react_app'),
    path('api/v1/', include('rental.api_urls')),
    path('api/schema', SpectacularAPIView.as_view(), name='api_schema'),
    path('api/docs', SpectacularSwaggerSplitView.as_view(url_name='api_schema'), name='api_docs'),
    path('', include('rental.urls')),
]

# Without a front proxy (local Docker, development) Django serves uploads itself, with cache
# headers; the view answers 404 unless SERVE_MEDIA is on.
urlpatterns += [re_path(r"^media/(?P<path>.*)$", serve_media, name="media")]