"""Vehicle photos: up to MAX_PHOTOS per vehicle, exactly one cover, WebP thumbnails.

Thumbnails are generated synchronously on upload (two widths, aspect ratio kept, never
upscaled). Callers that change a vehicle's photos hold the vehicle's row lock so the
"one cover" rule cannot be broken by concurrent requests (MySQL has no partial unique index).
"""
import hashlib
from io import BytesIO
from pathlib import Path

from django import forms
from django.core.files.base import ContentFile
from django.db import transaction
from PIL import Image, ImageOps

from ..models import Vehicle, VehiclePhoto

MAX_PHOTOS = 8
THUMBNAIL_WIDTHS = {"thumb_small": 400, "thumb_large": 1200}
# Card thumbnails are small on screen, so they take a lower quality to stay well under 60 KB.
WEBP_QUALITY = {400: 72, 1200: 80}


def render_webp(source, width, quality=None):
    """WebP bytes of `source` (a file-like object) scaled down to at most `width` pixels wide."""
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGBA" if image.mode in ("RGBA", "LA", "P") else "RGB")
        if image.width > width:
            image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
        out = BytesIO()
        image.save(out, format="WEBP", quality=quality or WEBP_QUALITY.get(width, 80), method=6)
        return out.getvalue()


def image_facts(source):
    """(width, height, dominant colour as #rrggbb) of the upright image, for layout and placeholders."""
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        r, g, b = image.resize((1, 1), Image.BOX).getpixel((0, 0))
        return image.width, image.height, f"#{r:02x}{g:02x}{b:02x}"


def make_thumbnails(photo):
    """Write the WebP renditions. Names carry a content hash, so browsers may cache them forever."""
    stem = Path(photo.image.name).stem
    photo.image.open("rb")
    try:
        original = photo.image.read()
    finally:
        photo.image.close()
    photo.width, photo.height, photo.color = image_facts(BytesIO(original))
    for field, width in THUMBNAIL_WIDTHS.items():
        data = render_webp(BytesIO(original), width)
        digest = hashlib.sha256(data).hexdigest()[:10]
        old = getattr(photo, field)
        if old and old.name:
            old.storage.delete(old.name)
        old.save(f"{stem}-{width}-{digest}.webp", ContentFile(data), save=False)
    photo.save(update_fields=[*THUMBNAIL_WIDTHS, "width", "height", "color"])


def validate_upload(image):
    if not getattr(image, "image", None):
        raise forms.ValidationError("Upload an image file.")
    if image.size > 5 * 1024 * 1024 or max(image.image.size) > 4096:
        raise forms.ValidationError("Use an image up to 5 MB and 4096 pixels per side.")
    if image.image.format not in {"JPEG", "PNG", "WEBP"}:
        raise forms.ValidationError("Choose a JPEG, PNG, or WebP image.")
    return image


@transaction.atomic
def add_photo(vehicle, upload, cover=False):
    vehicle = Vehicle.objects.select_for_update().get(pk=vehicle.pk)
    photos = vehicle.photos.all()
    if photos.count() >= MAX_PHOTOS:
        raise forms.ValidationError(f"A vehicle can have up to {MAX_PHOTOS} photos.")
    last = photos.order_by("-order").first()
    photo = VehiclePhoto(vehicle=vehicle, order=(last.order + 1) if last else 0, is_cover=cover or last is None)
    photo.image.save(Path(upload.name).name, upload, save=False)
    if photo.is_cover:
        photos.update(is_cover=False)
    photo.save()
    make_thumbnails(photo)
    return photo


@transaction.atomic
def set_cover(vehicle, photo_id):
    vehicle = Vehicle.objects.select_for_update().get(pk=vehicle.pk)
    photo = vehicle.photos.get(pk=photo_id)
    vehicle.photos.exclude(pk=photo.pk).update(is_cover=False)
    VehiclePhoto.objects.filter(pk=photo.pk).update(is_cover=True)
    return photo


@transaction.atomic
def reorder(vehicle, photo_ids):
    vehicle = Vehicle.objects.select_for_update().get(pk=vehicle.pk)
    current = set(vehicle.photos.values_list("pk", flat=True))
    if set(photo_ids) != current or len(photo_ids) != len(current):
        raise forms.ValidationError("List every photo of this vehicle exactly once.")
    for position, pk in enumerate(photo_ids):
        VehiclePhoto.objects.filter(pk=pk).update(order=position)


@transaction.atomic
def delete_photo(vehicle, photo_id):
    vehicle = Vehicle.objects.select_for_update().get(pk=vehicle.pk)
    photo = vehicle.photos.get(pk=photo_id)
    if vehicle.photos.count() == 1:
        raise forms.ValidationError("A listing needs at least one photo.")
    photo.delete()
    if photo.is_cover:
        nxt = vehicle.photos.order_by("order", "pk").first()
        VehiclePhoto.objects.filter(pk=nxt.pk).update(is_cover=True)
    names = [getattr(photo, field).name for field in ("image", *THUMBNAIL_WIDTHS) if getattr(photo, field)]
    storage = photo.image.storage
    # Remove the files only once the deletion is committed; a rollback must not leave a row without its file.
    transaction.on_commit(lambda: [storage.delete(name) for name in names])


def replace_cover(vehicle, upload):
    """Used by the listing form's single image field: the upload becomes the new cover."""
    return add_photo(vehicle, upload, cover=True)
