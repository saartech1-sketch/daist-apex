-- Create an on-demand APEX application process named LOAD_STAGES with this code.
-- The query returns the destination URL for each stage in the "url" property.
DECLARE
    l_username VARCHAR2(50) := apex_application.g_user;
BEGIN
    apex_json.open_array;
    FOR stage_row IN (
        SELECT stages.stage_number,
               stages.description,
               user_stage.score,
               CASE WHEN user_stage.stage IS NULL THEN 'N' ELSE 'Y' END AS finished,
               apex_page.get_url(
                   p_page   => 1,
                   p_items  => 'P2_LEVEL',
                   p_values => stages.stage_number
               ) AS stage_url
          FROM stages
          LEFT JOIN user_stages user_stage
            ON user_stage.stage = stages.stage_number
           AND user_stage.username = l_username
         ORDER BY stages.stage_number
    ) LOOP
        apex_json.open_object;
        apex_json.write('stageNumber', stage_row.stage_number);
        apex_json.write('name', 'Level ' || stage_row.stage_number);
        apex_json.write('description', stage_row.description);
        apex_json.write('url', stage_row.stage_url);
        apex_json.write('finished', stage_row.finished = 'Y');
        apex_json.write('score', stage_row.score);
        apex_json.close_object;
    END LOOP;
    apex_json.close_array;
END;

