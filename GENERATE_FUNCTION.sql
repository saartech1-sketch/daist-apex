DECLARE
    l_payload       CLOB;
    l_system_prompt CLOB;
    l_prompt        CLOB;
    l_response      CLOB;
BEGIN
    l_payload := apex_application.g_clob_01;

    IF l_payload IS NULL THEN
        raise_application_error(-20001, 'Prompt messages are required.');
    END IF;

    apex_json.parse(p_source => l_payload);

    IF NVL(apex_json.get_count(p_path => 'messages'), 0) != 2
       OR apex_json.get_varchar2('messages[%d].role', p0 => 1) != 'system'
       OR apex_json.get_varchar2('messages[%d].role', p0 => 2) != 'user' THEN
        raise_application_error(-20002, 'Expected system and user prompt messages.');
    END IF;

    l_system_prompt := apex_json.get_clob(
        p_path => 'messages[%d].content',
        p0     => 1
    );
    l_prompt := apex_json.get_clob(
        p_path => 'messages[%d].content',
        p0     => 2
    );

    l_response := apex_ai.generate(
        p_prompt            => l_prompt,
        p_system_prompt     => l_system_prompt,
        p_service_static_id => 'daisy-openai'
    );

    sys.htp.p(l_response);
EXCEPTION
    WHEN OTHERS THEN
        apex_json.open_object;
        apex_json.write('error', sqlerrm);
        apex_json.close_object;
END;