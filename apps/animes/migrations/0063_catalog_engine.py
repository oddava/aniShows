# Catalog engine (apps.animes.catalog): its run log and lane cursors, and the scope
# and hydration fields on Anime.

import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('anime', '0062_anime_meta_description_locked'),
    ]

    operations = [
        migrations.CreateModel(
            name='CatalogCursor',
            fields=[
                ('lane', models.CharField(max_length=16, primary_key=True, serialize=False)),
                ('state', models.JSONField(blank=True, default=dict)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.CreateModel(
            name='CatalogRun',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('lane', models.CharField(choices=[('seasons', 'Seasons'), ('delta', 'Changes'), ('trending', 'Trending'), ('airing', 'Airing'), ('hydrate', 'Details'), ('seed', 'Full sweep')], max_length=16)),
                ('trigger', models.CharField(choices=[('schedule', 'Schedule'), ('admin', 'Admin'), ('chain', 'Continued')], default='schedule', max_length=16)),
                ('status', models.CharField(choices=[('running', 'Running'), ('succeeded', 'Succeeded'), ('partial', 'Stopped early'), ('failed', 'Failed')], default='running', max_length=16)),
                ('started_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('finished_at', models.DateTimeField(blank=True, null=True)),
                ('requests', models.PositiveIntegerField(default=0)),
                ('fetched', models.PositiveIntegerField(default=0)),
                ('created', models.PositiveIntegerField(default=0)),
                ('updated', models.PositiveIntegerField(default=0)),
                ('excluded', models.PositiveIntegerField(default=0)),
                ('detail', models.JSONField(blank=True, default=dict)),
                ('error', models.TextField(blank=True)),
                ('triggered_by', models.IntegerField(blank=True, null=True)),
            ],
            options={
                'ordering': ['-started_at', '-id'],
            },
        ),
        migrations.AddField(
            model_name='anime',
            name='anilist_format',
            field=models.CharField(blank=True, max_length=16),
        ),
        migrations.AddField(
            model_name='anime',
            name='anilist_updated_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='anime',
            name='catalog_excluded',
            field=models.CharField(blank=True, db_index=True, max_length=32),
        ),
        migrations.AddField(
            model_name='anime',
            name='country_of_origin',
            field=models.CharField(blank=True, max_length=2),
        ),
        migrations.AddField(
            model_name='anime',
            name='hydrate_requested_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='anime',
            name='hydrated_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name='catalogrun',
            index=models.Index(fields=['lane', '-started_at'], name='catalog_run_lane_idx'),
        ),
        migrations.AddIndex(
            model_name='catalogrun',
            index=models.Index(fields=['-started_at'], name='catalog_run_started_idx'),
        ),
    ]
