-- PublisherIQ-authored initial preset catalog for the Custom Daily Steam
-- Opportunity Brief. Preset versions are immutable; this seed creates version
-- 1 only when a slug/version does not already exist.

DO $$
DECLARE
    seed record;
    resolved_preset_id uuid;
    resolved_version_id uuid;
BEGIN
    FOR seed IN
        SELECT *
        FROM (
            VALUES
                (
                    'roguelike-deckbuilder',
                    'Roguelike Deckbuilder',
                    'Upcoming or evolving games that visibly combine roguelike and deckbuilding taxonomy.',
                    '{
                      "schemaVersion":"opportunity-rules/v1",
                      "required":[
                        {"id":"taxonomy","label":"Roguelike + Deckbuilding","operator":"all","clauses":[
                          {"id":"tag-roguelike","field":"tags","operator":"contains","value":"Roguelike"},
                          {"id":"tag-deckbuilding","field":"tags","operator":"contains","value":"Deckbuilding"}
                        ]}
                      ],
                      "preferred":[
                        {"id":"demo","label":"Playable demo","operator":"all","importance":"high","clauses":[
                          {"id":"has-demo","field":"has_demo","operator":"equals","value":true}
                        ]},
                        {"id":"indie-scale","label":"Smaller publisher portfolio","operator":"all","importance":"medium","clauses":[
                          {"id":"publisher-size","field":"publisher_game_count","operator":"less_than_or_equal","value":10}
                        ]}
                      ],
                      "excluded":[
                        {"id":"adult-content","label":"Adult-only content","operator":"any","clauses":[
                          {"id":"adult","field":"content_descriptors","operator":"contains","value":"adult"}
                        ]}
                      ]
                    }'::jsonb,
                    ARRAY['release','taxonomy','store-page','media','reviews','ccu']::text[]
                ),
                (
                    'cozy-sim',
                    'Cozy Sim',
                    'Cozy simulation games with visible product-readiness and audience signals.',
                    '{
                      "schemaVersion":"opportunity-rules/v1",
                      "required":[
                        {"id":"taxonomy","label":"Cozy simulation","operator":"all","clauses":[
                          {"id":"tag-cozy","field":"tags","operator":"contains","value":"Cozy"},
                          {"id":"genre-simulation","field":"genres","operator":"contains","value":"Simulation"}
                        ]}
                      ],
                      "preferred":[
                        {"id":"demo","label":"Playable demo","operator":"all","importance":"high","clauses":[
                          {"id":"has-demo","field":"has_demo","operator":"equals","value":true}
                        ]},
                        {"id":"controller","label":"Controller support","operator":"all","importance":"medium","clauses":[
                          {"id":"controller-support","field":"controller_support","operator":"exists"}
                        ]}
                      ],
                      "excluded":[
                        {"id":"adult-content","label":"Adult-only content","operator":"any","clauses":[
                          {"id":"adult","field":"content_descriptors","operator":"contains","value":"adult"}
                        ]}
                      ]
                    }'::jsonb,
                    ARRAY['release','taxonomy','store-page','media','reviews','ccu']::text[]
                ),
                (
                    'extraction-shooter',
                    'Extraction Shooter',
                    'Games positioned around extraction loops and shooting mechanics.',
                    '{
                      "schemaVersion":"opportunity-rules/v1",
                      "required":[
                        {"id":"taxonomy","label":"Extraction shooter","operator":"all","clauses":[
                          {"id":"tag-extraction","field":"tags","operator":"contains","value":"Extraction Shooter"}
                        ]}
                      ],
                      "preferred":[
                        {"id":"multiplayer","label":"Multiplayer features","operator":"any","importance":"high","clauses":[
                          {"id":"online-coop","field":"categories","operator":"contains","value":"Online Co-op"},
                          {"id":"multi-player","field":"categories","operator":"contains","value":"Multi-player"}
                        ]},
                        {"id":"early-traction","label":"Early player activity","operator":"all","importance":"medium","clauses":[
                          {"id":"ccu","field":"ccu_peak","operator":"greater_than_or_equal","value":50}
                        ]}
                      ],
                      "excluded":[
                        {"id":"adult-content","label":"Adult-only content","operator":"any","clauses":[
                          {"id":"adult","field":"content_descriptors","operator":"contains","value":"adult"}
                        ]}
                      ]
                    }'::jsonb,
                    ARRAY['release','taxonomy','platform','build','reviews','ccu']::text[]
                ),
                (
                    'narrative-horror',
                    'Narrative Horror',
                    'Story-forward horror games with strong presentation or demo readiness.',
                    '{
                      "schemaVersion":"opportunity-rules/v1",
                      "required":[
                        {"id":"taxonomy","label":"Narrative horror","operator":"all","clauses":[
                          {"id":"tag-horror","field":"tags","operator":"contains","value":"Horror"},
                          {"id":"tag-story","field":"tags","operator":"contains","value":"Story Rich"}
                        ]}
                      ],
                      "preferred":[
                        {"id":"demo","label":"Playable demo","operator":"all","importance":"high","clauses":[
                          {"id":"has-demo","field":"has_demo","operator":"equals","value":true}
                        ]},
                        {"id":"sentiment","label":"Positive player response","operator":"all","importance":"medium","clauses":[
                          {"id":"positive","field":"positive_percentage","operator":"greater_than_or_equal","value":80}
                        ]}
                      ],
                      "excluded":[
                        {"id":"adult-content","label":"Adult-only content","operator":"any","clauses":[
                          {"id":"adult","field":"content_descriptors","operator":"contains","value":"adult"}
                        ]}
                      ]
                    }'::jsonb,
                    ARRAY['release','taxonomy','store-page','media','announcement','reviews','ccu']::text[]
                ),
                (
                    'colony-sim-survival',
                    'Colony Sim + Survival',
                    'Colony simulations that also expose meaningful survival positioning.',
                    '{
                      "schemaVersion":"opportunity-rules/v1",
                      "required":[
                        {"id":"taxonomy","label":"Colony simulation + survival","operator":"all","clauses":[
                          {"id":"tag-colony","field":"tags","operator":"contains","value":"Colony Sim"},
                          {"id":"tag-survival","field":"tags","operator":"contains","value":"Survival"}
                        ]}
                      ],
                      "preferred":[
                        {"id":"early-access","label":"Early Access positioning","operator":"all","importance":"medium","clauses":[
                          {"id":"release-state","field":"release_state","operator":"contains","value":"early access"}
                        ]},
                        {"id":"demo","label":"Playable demo","operator":"all","importance":"high","clauses":[
                          {"id":"has-demo","field":"has_demo","operator":"equals","value":true}
                        ]}
                      ],
                      "excluded":[
                        {"id":"adult-content","label":"Adult-only content","operator":"any","clauses":[
                          {"id":"adult","field":"content_descriptors","operator":"contains","value":"adult"}
                        ]}
                      ]
                    }'::jsonb,
                    ARRAY['release','taxonomy','build','store-page','reviews','ccu']::text[]
                ),
                (
                    'new-self-published-indie-releases',
                    'New Self-Published Indie Releases',
                    'New release events where normalized listed developer and publisher names overlap.',
                    '{
                      "schemaVersion":"opportunity-rules/v1",
                      "required":[
                        {"id":"released","label":"Released games","operator":"all","clauses":[
                          {"id":"is-released","field":"is_released","operator":"equals","value":true}
                        ]},
                        {"id":"self-published","label":"Observed self-published signal","operator":"all","clauses":[
                          {"id":"self-published-match","field":"self_published","operator":"equals","value":true}
                        ]}
                      ],
                      "preferred":[
                        {"id":"small-portfolio","label":"Smaller developer portfolio","operator":"all","importance":"high","clauses":[
                          {"id":"developer-count","field":"developer_game_count","operator":"less_than_or_equal","value":5}
                        ]},
                        {"id":"early-response","label":"Early response","operator":"any","importance":"medium","clauses":[
                          {"id":"reviews-added","field":"reviews_added_7d","operator":"greater_than_or_equal","value":10},
                          {"id":"ccu","field":"ccu_peak","operator":"greater_than_or_equal","value":25}
                        ]}
                      ],
                      "excluded":[
                        {"id":"adult-content","label":"Adult-only content","operator":"any","clauses":[
                          {"id":"adult","field":"content_descriptors","operator":"contains","value":"adult"}
                        ]}
                      ]
                    }'::jsonb,
                    ARRAY['release','taxonomy','pricing','reviews','ccu']::text[]
                ),
                (
                    'upcoming-games-with-demos',
                    'Upcoming Games With Demos',
                    'Unreleased games with an observed Steam demo relationship.',
                    '{
                      "schemaVersion":"opportunity-rules/v1",
                      "required":[
                        {"id":"upcoming","label":"Upcoming","operator":"all","clauses":[
                          {"id":"is-unreleased","field":"is_released","operator":"equals","value":false}
                        ]},
                        {"id":"demo","label":"Playable demo","operator":"all","clauses":[
                          {"id":"has-demo","field":"has_demo","operator":"equals","value":true}
                        ]}
                      ],
                      "preferred":[
                        {"id":"dated","label":"Visible release date","operator":"all","importance":"high","clauses":[
                          {"id":"release-date","field":"release_date","operator":"exists"}
                        ]},
                        {"id":"no-publisher","label":"No publisher listed","operator":"all","importance":"medium","clauses":[
                          {"id":"publisher-state","field":"no_publisher_listed","operator":"equals","value":true}
                        ]}
                      ],
                      "excluded":[
                        {"id":"adult-content","label":"Adult-only content","operator":"any","clauses":[
                          {"id":"adult","field":"content_descriptors","operator":"contains","value":"adult"}
                        ]}
                      ]
                    }'::jsonb,
                    ARRAY['release','taxonomy','store-page','media','announcement']::text[]
                ),
                (
                    'recently-released-early-traction',
                    'Recently Released Games Showing Early Traction',
                    'Release events followed by measured review or CCU traction.',
                    '{
                      "schemaVersion":"opportunity-rules/v1",
                      "required":[
                        {"id":"released","label":"Released","operator":"all","clauses":[
                          {"id":"is-released","field":"is_released","operator":"equals","value":true}
                        ]}
                      ],
                      "preferred":[
                        {"id":"review-traction","label":"Review traction","operator":"all","importance":"high","clauses":[
                          {"id":"reviews-added","field":"reviews_added_7d","operator":"greater_than_or_equal","value":25}
                        ]},
                        {"id":"ccu-traction","label":"Player traction","operator":"all","importance":"high","clauses":[
                          {"id":"ccu","field":"ccu_peak","operator":"greater_than_or_equal","value":50}
                        ]},
                        {"id":"sentiment","label":"Positive response","operator":"all","importance":"medium","clauses":[
                          {"id":"positive","field":"positive_percentage","operator":"greater_than_or_equal","value":80}
                        ]}
                      ],
                      "excluded":[
                        {"id":"adult-content","label":"Adult-only content","operator":"any","clauses":[
                          {"id":"adult","field":"content_descriptors","operator":"contains","value":"adult"}
                        ]}
                      ]
                    }'::jsonb,
                    ARRAY['release','reviews','ccu','announcement','store-page']::text[]
                )
        ) AS seeds(slug, name, description, rules, event_subscriptions)
    LOOP
        INSERT INTO opportunity.presets (
            slug,
            name,
            description,
            editorial_status
        )
        VALUES (
            seed.slug,
            seed.name,
            seed.description,
            'published'
        )
        ON CONFLICT (slug) DO NOTHING;

        SELECT id INTO resolved_preset_id
        FROM opportunity.presets
        WHERE slug = seed.slug;

        INSERT INTO opportunity.preset_versions (
            preset_id,
            version,
            rules,
            event_subscriptions,
            calculation_config,
            change_notes,
            published_at
        )
        VALUES (
            resolved_preset_id,
            1,
            seed.rules,
            seed.event_subscriptions,
            jsonb_build_object(
                'rankingVersion', 'opportunity-ranking/v1',
                'cohortVersion', 'opportunity-cohort/v1',
                'marketVersion', 'opportunity-market/v1',
                'healthVersion', 'opportunity-health/v1'
            ),
            'Initial PublisherIQ-authored preset.',
            now()
        )
        ON CONFLICT (preset_id, version) DO NOTHING;

        SELECT id INTO resolved_version_id
        FROM opportunity.preset_versions
        WHERE preset_id = resolved_preset_id
          AND version = 1;

        UPDATE opportunity.presets
        SET current_version_id = COALESCE(current_version_id, resolved_version_id),
            updated_at = CASE
                WHEN current_version_id IS NULL THEN now()
                ELSE updated_at
            END
        WHERE id = resolved_preset_id;
    END LOOP;
END
$$;
